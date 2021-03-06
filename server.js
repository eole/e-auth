'use strict';

const express = require('express');
const OpenIDProvider = require('oidc-provider');
const MongoClient = require('mongodb').MongoClient;
const config = require('./config');
const MongoAdapterFactory = require('./lib/adapter/mongo-adapter-factory');
const OpenIDConnectInteractionsRoutes = require('./lib/routes/oidc-interactions');
const DebugRoutes = require('./lib/routes/debug');
const Account = require('./lib/models/account');
const morgan = require('morgan');
const ejs = require('ejs');

// Create Express app
const app = express();

MongoClient.connect(config.db.uri)
  .then(db => configure(db))
  .then(() => listen())
  .catch(err => {
    console.error(err); // eslint-disable-line no-console
    process.exit(1);
  })
;

function configure(db) {

  MongoAdapterFactory.setDatabase(db);

  // Complete configuration with custom adapter/hooks
  config.provider.options.adapter = MongoAdapterFactory;
  Account.setConfig(config.accounts);
  config.provider.options.findById = Account.findAccountById.bind(Account);

  // Override default logout view
  config.provider.options.logoutSource = function(form) {
    return new Promise((resolve, reject) => {
      ejs.renderFile(config.http.settings.views+'/logout.ejs', { form: form, req: this.req }, (err, content) => {
        if (err) return reject(err);
        this.body = content;
        return resolve(content);
      });
    });
  };

  const provider = new OpenIDProvider(config.provider.issuer, config.provider.options);

  // Initialize OpenID provider
  return provider.initialize({ keystore: config.provider.keystore, integrity: config.provider.integrity })
    .then(() => {

      // Load Express settings
      loadSettings(config.http.settings);

      // Mount express endpoints
      app.use(morgan('combined'));
      app.use(new OpenIDConnectInteractionsRoutes(config.http, provider));
      if (app.get('env') === 'development') app.use(new DebugRoutes(config.http, config.debug));
      app.use(config.http.providerBaseUrl, provider.callback);
      app.use('/public', express.static(__dirname + '/public'));

    })
  ;

}

function loadSettings(settings) {
  Object.keys(settings).forEach(key => {
    app.set(key, settings[key]);
  });
}

function listen() {
  return new Promise((resolve, reject) => {
    app.listen(config.http.port, config.http.host, err => {
      if (err) return reject(err);
      console.log(`listening on http://${config.http.host}:${config.http.port}`); // eslint-disable-line no-console
      return resolve();
    });
  });
}
