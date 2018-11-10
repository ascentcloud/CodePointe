const vscode = require('vscode');
const spawn = require('child_process').spawn;
const path = require('path');
const _ = require('lodash');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));

function activate(context) {
    const output = vscode.window.createOutputChannel('NateMate');

    const diagnosticCollection = vscode.languages.createDiagnosticCollection('sfdx');

    function exec(cmd, options) {
        const cmdSplit = cmd.split(' ');
    
        const stream = spawn(cmdSplit[0], cmdSplit.slice(1), options);
    
        return new Promise((resolve, reject) => {
            let result = '';
    
            stream.stdout.on('data', (data) => {
                result += data.toString();
    
                if (!options || options.console !== false) output.appendLine(data.toString());
            });
    
            stream.stderr.on('data', (data) => {
                result += data.toString();

                output.appendLine(data.toString());
            });
    
            stream.on('exit', (code) => {
                if (code) reject(result);
    
                resolve(result);
            });
        });
    }

    output.appendLine('natemate is now active!');

    async function deployFile(relativeFilePath, workspacePath) {
        output.appendLine('======================================================================================================================================================');

        output.appendLine(`deploying: ${relativeFilePath}`);

        diagnosticCollection.clear();

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `deploying: ${relativeFilePath}`,
                cancellable: false
            }, exec.bind(null, `sfdx force:source:deploy --json -p ${relativeFilePath}`, {cwd: workspacePath}));

            vscode.window.showInformationMessage(`deployed: ${relativeFilePath}`);
        } catch (err) {
            const errorMessage = JSON.parse(err);

            const problems = errorMessage.result;

            const diagnostics = problems.map((problem) => {
                const range = new vscode.Range(Number(problem.lineNumber) - 1, Number(problem.columnNumber) - 1, Number(problem.lineNumber) - 1, Number(problem.columnNumber) - 1);

                return new vscode.Diagnostic(range, problem.error.replace(/ {1}\([0-9]+:[0-9]+\)$/, ''));
            });

            diagnosticCollection.set(vscode.Uri.file(path.join(workspacePath, relativeFilePath)), diagnostics);

            vscode.window.showErrorMessage(`failed to deploy: ${relativeFilePath}`);
        }
    }

    const addDeployFile = (() => {
        let filesToDeploy = {};
        let deployTimeout = null;

        return (relativeFilePath, workspacePath) => {
            clearTimeout(deployTimeout);

            filesToDeploy[relativeFilePath] = relativeFilePath;

            deployTimeout = setTimeout(() => {
                let listOfFiles = [];

                _.forEach(filesToDeploy, (file) => {
                    listOfFiles.push(file);
                });

                deployFile(listOfFiles.join(','), workspacePath)

                filesToDeploy = {};
            }, 100);
        };
    })();

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (filePath) => {
        try {
            const workspacePath = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath.fileName)).uri.fsPath;

            const relativeFilePath = path.join('.', filePath.fileName.replace(workspacePath, ''));
            
            const sfRegex = /\.page$|\.component$|\.cls$|\.object$|\.trigger$|\.layout$|\.resource$|\.remoteSite$|\.labels$|\.app$|\.dashboard$|\.permissionset$|\.workflow$|\.email$|\.profile$|\.scf$|\.queue$|\.reportType$|\.report$|\.weblink$|\.tab$|\.letter$|\.role$|\.homePageComponent$|\.homePageLayout$|\.objectTranslation$|\.flow$|\.datacategorygroup$|\.snapshot$|\.site$|\.sharingRules$|\.settings$|\.callCenter$|\.community$|\.authProvider$|\.customApplicationComponent$|\.quickAction$|\.approvalProcess$|\.apxc$|\.apxt$/;

            const sfRegexMatch = relativeFilePath.match(sfRegex);

            const resourceRegex = /\w*\.resource/;
            
            const resourceRegexMatch = relativeFilePath.match(resourceRegex);

            if (sfRegexMatch) {
                addDeployFile(relativeFilePath, workspacePath);
            } else if (resourceRegexMatch) {
                await exec(`zip -FSr ${path.join(workspacePath, 'src', 'staticresources', resourceRegexMatch[0])} .`, {cwd: path.join(workspacePath, 'resource-bundles', resourceRegexMatch[0]), console: false});
    
                addDeployFile(path.join('src', 'staticresources', resourceRegexMatch[0]), workspacePath);
            }
        } catch (err) {
            output.appendLine(err);
        }
    }));

    async function compileProject(workspaceFolder) {
        const files = await fs.readdirAsync(path.join(workspaceFolder.uri.fsPath, 'resource-bundles'));

        const resourceBundles = [];

        for(let file of files) {
            if (!file.startsWith('.')) resourceBundles.push(file);
        }

        for(let resourceBundle of resourceBundles) {
            await exec(`zip -FSr ${path.join(workspaceFolder.uri.fsPath, 'src', 'staticresources', resourceBundle)}  .`, {cwd: path.join(workspaceFolder.uri.fsPath, 'resource-bundles', resourceBundle), console: false});
        }

        await exec('rm -rf force-app', {cwd: workspaceFolder.uri.fsPath});

        await exec(`sfdx force:mdapi:convert --rootdir ${path.join('src')}`, {cwd: workspaceFolder.uri.fsPath, console: false});

        return exec(`sfdx force:source:deploy -p ${path.join('force-app')}`, {cwd: workspaceFolder.uri.fsPath});
    }

    context.subscriptions.push(vscode.commands.registerCommand('extension.compileProject', async () => {
        for(let workspaceFolder of vscode.workspace.workspaceFolders) {
            output.appendLine('======================================================================================================================================================');

            output.appendLine('compiling project');

            try {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `compiling project`,
                    cancellable: false
                }, compileProject.bind(null, workspaceFolder));

                vscode.window.showInformationMessage(`project compiled`);
            } catch (err) {
                output.appendLine(err);

                vscode.window.showErrorMessage(`project compile failed`);
            }
        }
    }));
}
exports.activate = activate;

function deactivate() {
}
exports.deactivate = deactivate;
