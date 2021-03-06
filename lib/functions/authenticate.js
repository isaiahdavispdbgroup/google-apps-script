const fs = require('fs-extra');
const path = require('path');
const google = require('googleapis');
const request = require('request');
const openWebpage = require('open');
const http = require('http');
const url = require('url');
const constants = require('../constants.js');
const createFile = require('./createFile.js');
const getUserInfo = require('./getUserInfo.js');
const handleError = require('./handleError.js');
const pjson = require('../../package.json');

/**
 * Log user
 *
 * @param {google.auth.OAuth2} auth - An authorized OAuth2 client.
 * @returns {void}
 */
function logAuth(auth) {
    getUserInfo(auth).then((userInfo) => {
        const requestData = {
            version: pjson.version,
            info: userInfo,
        };

        request({
            url: 'https://gas-include.firebaseio.com/logs/auth.json',
            method: "POST",
            json: true,
            headers: {
                "content-type": "application/json",
            },
            body: requestData,
        });
    }).catch((err) => {
        handleError(err, false);
        return;
    });
}

/**
 * Store token to disk be used in later program executions.
 *
 * @param {Object} token - The token to store to disk.
 * @returns {Promise} - A promise resolving no value
 */
function storeToken(token) {
    return new Promise((resolve, reject) => {
        const file = {
            name: path.join(constants.GLOBAL_DIR, constants.GLOBAL_TOKEN),
            source: JSON.stringify(token),
        };
        createFile(file);
        resolve();
        return;
    });
}

/**
 * Get a token for a the defaut Oauth client.
 *
 * @param {google.auth.OAuth2} code - Optional code to get token for.
 * @param {google.auth.OAuth2} token - Optional token to refresh.
 * @param {google.auth.OAuth2} oauth2Client - The OAuth2 client to get token for.
 * @returns {Promise} - A promise resolving a tokent
 */
function getTokenDefault(code, token, oauth2Client) {
    return new Promise((resolve, reject) => {
        const requestData = {
            code,
            token,
        };
        request({
            url: 'https://us-central1-gas-include.cloudfunctions.net/getToken',
            method: "POST",
            json: true,
            headers: {
                "content-type": "application/json",
            },
            body: requestData,
        }, (error, response, body) => {
            const token = body;
            if (error) {
                reject(error);
            } else if (response.statusCode === 200) {
                resolve(token);
            } else {
                reject('Failed to get a token for the default Oauth client.');
            }
        });
    });
}

/**
 * Get a token for a custom Oauth client.
 *
 * @param {google.auth.OAuth2} code - Optional code to get token for.
 * @param {google.auth.OAuth2} oauth2Client - The OAuth2 client to get token for.
 * @returns {Promise} - A promise resolving a token
 */
function getTokenCustom(code, oauth2Client) {
    return new Promise((resolve, reject) => {
        if (code) {
            oauth2Client.getToken(code, (err, newToken) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(newToken);
                return;
            });
        } else {
            oauth2Client.refreshAccessToken((err, newToken) => {
                if (err) {
                    reject(err);
                }
                resolve(newToken);
                return;
            });
        }
    });
}

/**
 * Get and store new token after prompting for user authorization.
 *
 * @param {google.auth.OAuth2} code - Optional code to get token for.
 * @param {google.auth.OAuth2} token - Optional token to refresh.
 * @param {google.auth.OAuth2} oauth2Client - The OAuth2 client to get token for.
 * @param {bool} isCustomClient - Wether or not this is a custom oauthclient.
 * @returns {Promise} - A promise resolving an auth client
 */
function getToken(code, token, oauth2Client, isCustomClient) {
    return new Promise((resolve, reject) => {
        if (isCustomClient) {
            getTokenCustom(code, oauth2Client).then((newToken) => {
                oauth2Client.credentials = newToken;
                storeToken(newToken).then(() => {
                    resolve(oauth2Client);
                    return;
                }, (err) => {
                    reject(err);
                    return;
                });
            }, (err) => {
                reject(err);
                return;
            });
        } else {
            getTokenDefault(code, token, oauth2Client).then((newToken) => {
                oauth2Client.credentials = newToken;
                storeToken(newToken).then(() => {
                    resolve(oauth2Client);
                    return;
                }, (err) => {
                    reject(err);
                    return;
                });
            }, (err) => {
                reject(err);
                return;
            });
        }
    });
}

/**
 * Get and store new token after prompting for user authorization.
 *
 * @param {google.auth.OAuth2} oauth2Client - The OAuth2 client to get token for.
 * @param {bool} isCustomClient - Whether or not this is a custom oauthclient.
 * @param {Object} [options] - Extra options.
 * @returns {Promise} - A promise resolving an auth client
 */
function getNewToken(oauth2Client, isCustomClient, options) {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const parsedUrl = url.parse(req.url, true);
            const queryAsObject = parsedUrl.query;
            if (queryAsObject.code) {
                getToken(queryAsObject.code, null, oauth2Client, isCustomClient).then((newOauth2Client) => {
                    resolve(newOauth2Client);
                    return;
                }, (err) => {
                    reject(err);
                    return;
                });
            } else {
                reject();
                return;
            }

            res.writeHead(302, {
                'Location': 'https://gas-include.firebaseapp.com/info/auth_successful.html',
            });
            res.end();

            req.connection.end(); // close the socket
            req.connection.destroy(); // close it really
            server.close(); // close the server
        }).listen(constants.REDIRECT_PORT);

        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: constants.SCOPES,
        });

        if (options.showUrl) {
            console.log('Please go to the following url in your browser:');
            console.log('----------------------------------------------');
            console.log(authUrl);
            console.log('----------------------------------------------');
        } else {
            openWebpage(authUrl);
        }

        console.log(`A webbrowser should have opened, to allow 'gas' to:`);
        console.log(`    'View and manage the files in your Google Drive'`);
        console.log(`    'Modify your Google Apps Script scripts' behavior'`);
        console.log(``);
        console.log(`These permissions are necessary for pulling and pushing code from/to your Google Drive.`);
    });
}

/**
 * Create an OAuth2 client with the given credentials.
 *
 * @returns {Promise} - A promise resolving an auth client
 */
function getAuthClient() {
    return new Promise((resolve, reject) => {
        const redirectUrl = constants.REDIRECT_URL;
        const port = constants.REDIRECT_PORT;
        const configFilepath = path.join(constants.GLOBAL_DIR, constants.GLOBAL_CONFIG);

        let clientId = constants.CLIENT_ID;
        let clientSecret = null;
        let custom = false;

        // Parse config file
        try {
            const config = fs.readJsonSync(configFilepath, 'utf8');
            if (config.client) {
                clientSecret = config.client.secret;
                clientId = config.client.id;
                custom = true;
            }
        } catch (err) {
            reject(err);
            return;
        }

        const client = new google.auth.OAuth2(clientId, clientSecret, `${redirectUrl}:${port}`);

        resolve({
            client,
            custom,
        });
    });
}

/**
 * Create an OAuth2 client with the given credentials.
 *
 * @param {Object} options - Extra options.
 * @returns {Promise} - A promise resolving an auth client
 */
function authenticate(options) {
    return new Promise((resolve, reject) => {
        const tokenFile = path.join(constants.GLOBAL_DIR, constants.GLOBAL_TOKEN);
        const configFile = path.join(constants.GLOBAL_DIR, constants.GLOBAL_CONFIG);

        // Ensure a config file exists
        if (!fs.pathExistsSync(configFile)) {
            createFile({
                name: configFile,
                source: `{}\n`,
            });
        }

        // Remove the token file if we are forcing reauth
        if (options.force) {
            fs.removeSync(tokenFile);
        }

        // get Oauth client
        getAuthClient().then((oauth2ClientResult) => {
            const oauth2Client = oauth2ClientResult.client;
            const isCustomClient = oauth2ClientResult.custom;

            // Check if we have previously stored a token.
            fs.readFile(tokenFile, 'utf8', (err, token) => {

                // If we can't find a token
                if (err !== null || token === '') {
                    getNewToken(oauth2Client, isCustomClient, options).then((newOauth2Client) => {
                        logAuth(newOauth2Client);
                        resolve(newOauth2Client);
                        return;
                    }, (err) => {
                        reject(err);
                        return;
                    });
                } else {

                    // If we can find the token, refresh it, get a new one or do nothing
                    const tokenObject = JSON.parse(token);
                    oauth2Client.credentials = tokenObject;
                    const ttl = oauth2Client.credentials.expiry_date - Date.now();

                    if (ttl < 10 * 1000 || options.refresh) {
                        getToken(null, token, oauth2Client, isCustomClient).then((newOauth2Client) => {
                            resolve(newOauth2Client);
                            return;
                        }, (err) => {
                            getNewToken(oauth2Client, isCustomClient, options).then((newOauth2Client) => {
                                resolve(newOauth2Client);
                                return;
                            }, (err) => {
                                reject(err);
                                return;
                            });
                        });
                    } else {
                        resolve(oauth2Client);
                        return;

                        // Piece of code if we ever want to save userdata in firebase

                        // var config = {
                        //     apiKey: "AIzaSyC5dVRphYjAxP6deLEqeGp3Hd49UGjOK8Q",
                        //     authDomain: "gas-include.firebaseapp.com",
                        //     databaseURL: "https://gas-include.firebaseio.com",
                        //     storageBucket: "gas-include.appspot.com",
                        //     messagingSenderId: "671639553297",
                        // };
                        // firebase.initializeApp(config);
                        // var credential = firebase.auth.GoogleAuthProvider.credential(tokenObject.id_token);

                        // // Sign in with credential from the Google user.
                        // firebase.auth().signInWithCredential(credential).catch(function (error) {
                        //     // Handle Errors here.
                        //     var errorCode = error.code;
                        //     var errorMessage = error.message;
                        //     // The email of the user's account used.
                        //     var email = error.email;
                        //     // The firebase.auth.AuthCredential type that was used.
                        //     var credential = error.credential;
                        //     // ...
                        // });
                    }
                }
            });
        }, (err) => {
            reject(err);
            return;
        });
    });
}

module.exports = authenticate;
