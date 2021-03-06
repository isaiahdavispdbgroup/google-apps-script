const google = require('googleapis');
const fs = require('fs-extra');
const path = require('path');
const constants = require('../constants.js');

/**
 * Push the local google script file back to Google Drive
 *
 * @param {google.auth.OAuth2} auth - An authorized OAuth2 client.
 * @param {string} projectId - Id of the Google Apps Script project.
 * @param {string} type - Pushing local or remote.
 * @param {string} rootFolder - relative path to the rootFolder of the project
 * @returns {Promise} - A promise resolving no value
 */
function pushToRemote(auth, projectId, type, rootFolder) {
    return new Promise((resolve, reject) => {
        const epoch = Date.now();

        // Decide which file to send to remote
        let file;
        if (type === 'remote') {
            file = path.join(rootFolder, constants.META_DIR, constants.META_REMOTE);
        } else {
            file = path.join(rootFolder, constants.META_DIR, constants.META_LOCAL);
        }

        // Read the file we need to push
        fs.readFile(file, 'utf8', (err, content) => {
            if (err) {
                reject(err);
                return;
            }

            // Push content to google drive
            const drive = google.drive('v3');
            drive.files.update({
                auth,
                supportsTeamDrives: true,
                fileId: projectId,
                media: {
                    body: content,
                    mimeType: constants.MIME_GAS_JSON,
                },
            }, (err, result) => {
                if (err) {
                    reject(err);
                    return;
                } else {
                    resolve(result);
                    return;
                }
            });
        });
    });
}

module.exports = pushToRemote;
