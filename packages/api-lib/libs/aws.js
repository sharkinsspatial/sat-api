'use strict'

const pLimit = require('p-limit')
const AWS = require('aws-sdk')

/**
 * check whether we are running in test mode (ava)
 *
 * @returns {boolean} true if in test mode otherwise false
 */
function inTestMode() {
  // this is automatically set by ava
  if (process.env.NODE_ENV === 'test') {
    if (!process.env.LOCALSTACK_HOST) {
      throw new Error('The LOCALSTACK_HOST environment variable is not set.')
    }
    return true
  }
  return false
}

/**
 * If we are in test, this function updates the AWS config
 * options to use LocalStack for testing
 *
 * @returns {undefined} undefined
 */
function overrideOptions() {
  // From https://github.com/localstack/localstack/blob/master/README.md
  const localStackPorts = {
    apigateway: 4567,
    cloudformation: 4581,
    cloudwatch: 4582,
    cloudwatchevents: 4582,
    dynamodb: 4569,
    dynamodbstreams: 4570,
    es: 4571,
    firehose: 4573,
    kinesis: 4568,
    lambda: 4574,
    redshift: 4577,
    route53: 4580,
    s3: 4572,
    ses: 4579,
    sns: 4575,
    sqs: 4576,
    ssm: 4583
  }

  if (inTestMode()) {
    const options = {
      accessKeyId: 'my-access-key-id',
      secretAccessKey: 'my-secret-access-key',
      region: 'us-east-1'
    }

    Object.keys(localStackPorts).forEach((service) => {
      AWS.config[service] = {
        endpoint: `http://${process.env.LOCALSTACK_HOST}:${localStackPorts[service]}`
      }
    })

    AWS.config.update(options)
  }
}

/**
* Delete a bucket and all of its objects from S3
*
* @param {string} bucket - name of the bucket
* @param {number} concurrency - how many files to delete in parallel
* @returns {Promise} - the promised result of `S3.deleteBucket`
**/
async function recursivelyDeleteS3Bucket(bucket, concurrency = 2) {
  const limit = pLimit(concurrency)
  const s3 = new AWS.S3()
  const response = await s3.listObjects({ Bucket: bucket }).promise()
  const s3Objects = response.Contents.map((o) => ({
    Bucket: bucket,
    Key: o.Key
  }))

  await Promise.all(s3Objects.map((param) => limit(() => s3.deleteObject(param).promise())))
  return s3.deleteBucket({ Bucket: bucket }).promise()
}

overrideOptions()
module.exports = {
  AWS,
  inTestMode,
  recursivelyDeleteS3Bucket
}
