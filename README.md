# sat-api 

[![CircleCI](https://circleci.com/gh/sat-utils/sat-api.svg?style=svg)](https://circleci.com/gh/sat-utils/sat-api)

Sat-api is a STAC compliant web API for searching and serving metadata for geospatial data (including but not limited to satellite imagery).

Development Seed runs an instance of sat-api for the Landsat-8 and Sentinel-2 imagery that is [hosted on AWS](https://aws.amazon.com/earth/). You can access this at https://sat-api.developmentseed.org. *An older version of sat-api can be found on the [legacy branch](https://github.com/sat-utils/sat-api/tree/legacy) and is deployed at https://api.developmentseed.org/satellites.*


## Documentation

The documentation includes information on the STAC spec, how to use the API, manage Elasticsearch, as well as how to deploy your own API on AWS. Access the documentation [here](docs) or on [gitbook](https://sat-utils.gitbook.io/sat-api/).


## Development

Sat-api includes a number of NPM packages (in the packages/ directory) that are used to create and populate an instance of sat-api. See the [sat-utils org on NPM](https://www.npmjs.com/org/sat-utils) for the full list of packages. [Lerna](https://github.com/lerna/lerna) is used for for managing these packages.

### Building local version

    # install dependencies in package.json
    $ yarn

    # run lerna boostrap to link together packages and install those package dependencies
    $ yarn bootstrap

    # run the build command in each of the packages (runs webpack)
    $ yarn build

    # to continually watch and build source files
    $ yarn watch

### Serving docs locally

    $ yarn docs-serve

On Linux, if you get the message "Error: watch *path*/book.json ENOSPC", issue the following command (require sudo access).

    $ echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p

### Publishing new package versions

To create a new version for npm:

- create a new branch from master
- `$ yarn update`
- Follow the prompt and select the correct the version, then commit the changes.
- Update [CHANGES.md](CHANGES.md).
- Tag your branch with the same version number
- Make a PR
- When the PR is merged, the npm packages are automatically deployed to npm

If you need to publish a package manually follow the steps below. **WARNING:** This is not recommended. Only use it if absolutely necessary.

- create a new branch from master
- `$ yarn update`
- Follow the prompt and select the correct the version, then commit the changes.
- Update [CHANGES.md](CHANGES.md).
- Tag your branch with the same version number
- Run: `./node_modules/.bin/lerna publish --skip-git --repo-version <replace-version> --yes --force-publish=* --npm-client=npm`


## About

[sat-api](http://github.com/sat-utils/sat-api.git) was made by [Development Seed](http://developmentseed.org).
