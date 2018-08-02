/* eslint-disable global-require */

'use strict'

const { AWS } = require('./libs/aws.js')


module.exports = {
  api: require('./libs/api.js'),
  es: require('./libs/es.js'),
  ingestcsv: require('./libs/ingest-csv.js'),
  AWS
}
