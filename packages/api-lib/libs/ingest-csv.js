'use strict'

const fs = require('fs')
const csv = require('fast-csv')
const pump = require('pump-promise')
const zlib = require('zlib')
const pLimit = require('p-limit')
const lodash = require('lodash')
const es = require('./es')
const { AWS } = require('./aws')
let esClient
const got = require('got')
const stream = require('stream')

const s3 = new AWS.S3()

const index = 'items'

// kick off processing next CSV file
function invokeLambda(bucket, key, nextFileNum, lastFileNum, arn, retries) {
  // figure out if there's a next file to process
  if (nextFileNum && arn) {
    const stepfunctions = new AWS.StepFunctions()
    const params = {
      stateMachineArn: arn,
      input: JSON.stringify({
        bucket, key, currentFileNum: nextFileNum, lastFileNum, arn, retries
      }),
      name: `ingest_${nextFileNum}_${Date.now()}`
    }
    return stepfunctions.startExecution(params, (err) => {
      if (err) {
        console.log(err, err.stack)
      }
      else {
        console.log(`launched ${JSON.stringify(params)}`)
      }
    }).promise()
  }

  return Promise.resolve()
}

/**
 * Download a given url to disk. If the url points to a zipped (gz)
 * file the function will unzip it before saving the file to disk
 *
 * @param {string} filePath - where to download the file (should include the filename)
 * @param {string} url - the url to download the file from
 * @returns {Promise<string>} path to the file
 */
function downloadUrl(filePath, url) {
  let promise
  const gotStream = got.stream(url)
  const writeStream = fs.createWriteStream(filePath)
  const gunzip = zlib.createGunzip()

  switch (url.substr(url.lastIndexOf('.') + 1)) {
  case 'csv':
    promise = pump(gotStream, writeStream)
    break
  case 'gz':
    promise = pump(gotStream, gunzip, writeStream)
    break
  default:
    throw new Error('case not found')
  }

  return promise.then(() => {
    console.log(`Stored download to ${filePath} from ${url}`)
    return filePath
  })
}

/**
 * Upload a given file to S3
 *
 * @param {string} filePath - path to the file
 * @param {string} bucket - the bucket name
 * @param {string} key - the S3 key
 * @returns {Promise<string>} the s3 uri
 */
async function uploadFile(filePath, bucket, key) {
  const readStream = fs.createReadStream(filePath)
  await s3.upload({
    Bucket: bucket,
    Key: key,
    Body: readStream
  }).promise()
  return `s3://${bucket}/${key}`
}

/**
 * Downloads a given url and then Uploads it to a given remote file to S3
 *
 * @param {string} url - the url of the file
 * @param {string} bucket - name of the bucket
 * @param {string} key - S3 object key
 * @param {string} [filePath] - where to download the file (should include the filename)
 * @returns {Promise} the final s3 uri
 */
async function syncUrl(url, bucket, key, filePath) {
  // download the file
  await downloadUrl(filePath, url)

  // upload the url
  return uploadFile(filePath, bucket, key)
}

// split a CSV to multiple files and trigger lambdas
function split({
  url,
  bucket,
  key,
  arn = '',
  inMaxFiles = 0,
  linesPerFile = 500,
  maxLambdas = 20,
  reverse = false,
  cb = null
}) {
  let maxFiles = inMaxFiles
  let fileCounter = 0
  let lineCounter = 0
  const lineBuffer = Buffer.alloc(4096)
  const gunzip = zlib.createGunzip()
  let newStream
  let currentFile
  let lineLength = 0
  let stopSplitting = false
  let header

  switch (url.substr(url.lastIndexOf('.') + 1)) {
  case 'csv':
    newStream = got.stream(url)
    break
  case 'gz':
    newStream = got.stream(url).pipe(gunzip)
    break
  default:
    return cb('case not found')
  }

  const build = function buildFile(line) {
    // get the csv header
    if (fileCounter === 0 && lineCounter === 0) header = line.toString()

    // create a new file or add to existing
    if (lineCounter === 0) {
      currentFile = new stream.PassThrough()
      currentFile.push(header)
    }
    else {
      currentFile.push(line.toString())
    }
    lineCounter += 1 // increment the filename
    lineLength = 0 // reset the buffer

    if (lineCounter > linesPerFile) {
      fileCounter += 1
      const fileName = `${key}${fileCounter}.csv`
      const params = {
        Body: currentFile,
        Bucket: bucket,
        Key: fileName
      }
      currentFile.end()
      s3.upload(params, (e) => {
        if (e) console.log(e)
      })
      lineCounter = 0 // start counting the lines again
      if ((fileCounter) % 250 === 0 && fileCounter !== 0) {
        console.log(`uploaded ${fileCounter} files`)
      }
      // sentinel csv is ordered from old to new so always have to go all the way back
      if ((fileCounter >= maxFiles) && maxFiles !== 0 && !reverse) {
        stopSplitting = true
      }
    }
  }

  newStream.on('data', (data) => {
    if (!stopSplitting) {
      const dataLen = data.length
      for (let i = 0; i < dataLen; i += 1) {
        lineBuffer[lineLength] = data[i] // Buffer new line data.
        lineLength += 1
        if (data[i] === 10) { // Newline char was found.
          build(lineBuffer.slice(0, lineLength))
        }
      }
    }
  })

  newStream.on('error', (e) => cb(e))

  return newStream.on('end', () => {
    const limit = pLimit(3) //set concurrent call to 3 at a time
    // write the last records
    if (lineCounter > 0) {
      fileCounter += 1
      const params = {
        Body: currentFile,
        Bucket: bucket,
        Key: `${key}${fileCounter}.csv`
      }
      s3.upload(params, (e) => {
        if (e) console.log(e)
      })
      currentFile.end()
    }
    console.log(`${fileCounter - 1} total files`)
    // determine batches and run lambdas
    if (arn !== '') {
      maxFiles = (maxFiles === 0) ? fileCounter : Math.min(maxFiles, fileCounter)
      const numLambdas = Math.min(maxFiles, maxLambdas)
      const batchSize = Math.floor(maxFiles / numLambdas)
      const extra = maxFiles % numLambdas
      const maxEndFile = reverse ? fileCounter : maxFiles

      let startFile = reverse ? (fileCounter - maxFiles) + 1 : 1
      let endFile
      console.log(
        `Invoking ${numLambdas} batches of Lambdas of ${batchSize} files each with ` +
        `${extra} extra (Files ${startFile}-${maxEndFile})`
      )

      const promises = lodash.range(numLambdas).map((i) => limit(() => {
        endFile = (i < extra) ? startFile + batchSize : (startFile + batchSize) - 1
        startFile = endFile + 1
        return invokeLambda(bucket, key, startFile - 1, Math.min(endFile, maxEndFile), arn)
      }))

      return Promise.all(promises).then(() => cb()).catch(cb)
    }
    cb()
    return Promise.resolve()
  })
}

// Process single CSV file
function processFile(bucket, key, transform, client) {
  if (!esClient) {
    esClient = client
  }
  // get the csv file s3://${bucket}/${key}
  console.log(`Processing s3://${bucket}/${key}`)
  const csvStream = csv.parse({ headers: true, objectMode: true })
  s3.getObject({ Bucket: bucket, Key: key }).createReadStream().pipe(csvStream)
  return es.streamToEs(csvStream, transform, esClient, index)
}

// Process 1 or more CSV files by processing one at a time, then invoking the next
function processFiles(
  bucket,
  key,
  transform,
  cb,
  currentFileNum = 0,
  lastFileNum = 0,
  arn = null,
  retries = 0
) {
  const maxRetries = 5

  const nextFileNum = (currentFileNum < lastFileNum) ? currentFileNum + 1 : null

  return processFile(bucket, `${key}${currentFileNum}.csv`, transform)
    .then(() => {
      invokeLambda(bucket, key, nextFileNum, lastFileNum, arn, 0)
      cb()
    }).catch(() => {
      // if CSV failed, try it again
      if (retries < maxRetries) {
        invokeLambda(bucket, key, currentFileNum, lastFileNum, arn, retries + 1)
      }
      else {
        // log and move onto the next one
        console.log(`error: maxRetries hit in file ${currentFileNum}`)
        invokeLambda(bucket, key, nextFileNum, lastFileNum, arn, 0)
      }
      cb()
    })
}

async function update({
  client,
  bucket,
  key,
  transform,
  cb = null,
  currentFileNum = 0,
  lastFileNum = 0,
  arn = null,
  retries = 0
}) {
  esClient = client
  return es.putMapping(client, index)
    .then(() => processFiles(bucket, key, transform, cb, currentFileNum, lastFileNum, arn, retries))
    .catch(cb)
}


module.exports = {
  update: update,
  split: split,
  uploadFile,
  processFile,
  downloadUrl,
  syncUrl
}
