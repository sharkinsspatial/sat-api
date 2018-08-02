'use strict'

const os = require('os')
const fs = require('fs-extra')
const nock = require('nock')
const path = require('path')
const test = require('ava')
const randomstring = require('randomstring')
const { downloadUrl, uploadFile, syncUrl } = require('../libs/ingest-csv')
const { AWS, recursivelyDeleteS3Bucket } = require('../libs/aws')

const tempDir = fs.mkdtempSync(`${os.tmpdir()}${path.sep}`)
const bucket = randomstring.generate()
const s3 = new AWS.S3()

test.before(async () => {
  await s3.createBucket({ Bucket: bucket }).promise()
})

test.after.always(async () => {
  await fs.remove(tempDir)
  await recursivelyDeleteS3Bucket(bucket)
})

test.serial('upload file to S3', async (t) => {
  const file = path.join(__dirname, 'fixtures/remote.csv')
  const uri = await uploadFile(file, bucket, 'mytestfile.csv')
  t.is(uri, `s3://${bucket}/mytestfile.csv`)
})

test.serial('sync url to S3', async (t) => {
  nock('https://example.com')
    .get('/remote.csv')
    .reply(200, () => fs.createReadStream(path.join(__dirname, 'fixtures/remote.csv')))
  const target = path.join(tempDir, 'downloaded.csv')
  const uri = await syncUrl('https://example.com/remote.csv', bucket, 'remote.csv', target)

  t.is(uri, `s3://${bucket}/remote.csv`)
})

test.serial('download a unzipped csv', async (t) => {
  nock('https://example.com')
    .get('/remote.csv')
    .reply(200, () => fs.createReadStream(path.join(__dirname, 'fixtures/remote.csv')))
  const target = path.join(tempDir, 'downloaded.csv')
  const filePath = await downloadUrl(target, 'https://example.com/remote.csv')
  t.is(filePath, target)

  // make sure the file exists
  const stat = fs.statSync(target)
  t.true(stat.isFile())

  // read the content
  const content = fs.readFileSync(target)
  t.is(content.toString(), 'this is a test')
})

test.serial('download a zipped csv', async (t) => {
  nock('https://example.com')
    .get('/remote.csv.gz')
    .reply(200, () => fs.createReadStream(path.join(__dirname, 'fixtures/remote.csv.gz')))
  const target = path.join(tempDir, 'downloadedZipped.csv')
  const filePath = await downloadUrl(target, 'https://example.com/remote.csv.gz')
  t.is(filePath, target)

  // make sure the file exists
  const stat = fs.statSync(target)
  t.true(stat.isFile())

  // read the content
  const content = fs.readFileSync(target)
  t.is(content.toString(), 'this is a test')
})

