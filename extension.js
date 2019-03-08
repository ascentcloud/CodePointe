const vscode = require('vscode');
const spawn = require('child_process').spawn;
const path = require('path');
const _ = require('lodash');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));

const output = vscode.window.createOutputChannel('CodePointe');

const diagnosticCollection = vscode.languages.createDiagnosticCollection('CodePointe');

function exec(cmd, cmdArgs = [], options) {
    const stream = spawn(cmd, cmdArgs, options);

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

class Deploy {
    constructor(workspace) {
        this.workspace = workspace;

        this.bundles = [];

        this.sfFiles = [];
    }

    get deployData() {
        return this;
    }

    addBundle(bundle) {
        this.bundles.push(bundle);

        this.bundles = _.uniq(this.bundles);
    }

    addSfFile(sfFile) {
        this.sfFiles.push(sfFile);

        this.sfFiles = _.uniq(this.sfFiles);
    }

    async runUserScript(scriptName) {
        let userScripts;

        try {
            delete require.cache[require.resolve(path.join(this.workspace, '.codepointe.js'))]

            userScripts = require(path.join(this.workspace, '.codepointe.js'));
        } catch (err) {
            return;
        }

        try {
            if (userScripts && userScripts[scriptName]) {
                await userScripts[scriptName](this.deployData);
            }
        } catch (err) {
            output.appendLine(err);

            throw err;
        }
    }

    async zipBundles() {
        await this.runUserScript('beforeZipBundle');

        for (let bundle of this.bundles) {
            const cmd = 'zip';
            const cmdArgs = ['-FSr', path.join(this.workspace, 'src', 'staticresources', bundle), '.'];
            await exec(cmd, cmdArgs, {cwd: path.join(this.workspace, 'resource-bundles', bundle), console: false});
        }

        await this.runUserScript('afterZipBundle');
    }

    async run() {
        try {
            diagnosticCollection.clear();

            await this.zipBundles();

            await this.runUserScript('beforeDeployFiles');
            const cmd = 'sfdx';
            const cmdArgs = ['force:source:deploy', '--json', '-p', this.sfFiles.join(',')]
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `deploying: ${this.sfFiles.join(',')}`,
                cancellable: false
            }, exec.bind(null, cmd, cmdArgs, {cwd: this.workspace}));

            await this.runUserScript('afterDeployFiles');

            output.appendLine('deploy complete');
        } catch (err) {
            output.appendLine(`failed to deploy: ${this.sfFiles.join(',')}`);

            vscode.window.showErrorMessage(`failed to deploy: ${this.sfFiles.join(',')}`);

            let errorMessage = '';

            try {
                errorMessage = JSON.parse(err);
            } catch (e) {
                output.appendLine(e);

                output.appendLine(err);
            }

            const problemsByFile = _.groupBy(errorMessage.result, 'filePath');

            _.forEach(problemsByFile, (fileProblems, file) => {
                const diagnostics = fileProblems.map((problem) => {
                    const range = new vscode.Range(Number(problem.lineNumber) - 1, Number(problem.columnNumber) - 1, Number(problem.lineNumber) - 1, Number(problem.columnNumber) - 1);

                    return new vscode.Diagnostic(range, problem.error.replace(/ {1}\([0-9]+:[0-9]+\)$/, ''));
                });

                diagnosticCollection.set(vscode.Uri.file(path.join(this.workspace, file)), diagnostics);
            });
        }
    }

    async runCompileProject() {
        try {
            diagnosticCollection.clear();

            let files;

            try {
                files = await fs.readdirAsync(path.join(this.workspace, 'resource-bundles'));
            } catch (err) {
                files = [];
            }

            for(let file of files) {
                if (!file.startsWith('.')) this.addBundle(file);
            }

            await this.zipBundles();

            await this.runUserScript('beforeProjectCompile');
            const cmd = 'sfdx';
            const cmdArgs = ['force:mdapi:deploy', '--json', '--deploydir', path.join('src'), '--wait', '10']
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `deploying project to salesforce`,
                cancellable: false
            }, exec.bind(null, cmd, cmdArgs, {cwd: this.workspace}));

            await this.runUserScript('afterProjectCompile');

            output.appendLine('project compile complete');
        } catch (err) {
            output.appendLine('project compile failed');

            vscode.window.showErrorMessage('project compile failed');

            let errorMessage = '';

            try {
                errorMessage = JSON.parse(err);
            } catch (e) {
                output.appendLine(e);

                output.appendLine(err);
            }

            const failures = _.filter(errorMessage.result.details.componentFailures, (component) => {
                return component.success === 'false';
            });

            const problemsByFile = _.groupBy(failures, 'fileName');

            _.forEach(problemsByFile, (fileProblems, file) => {
                const diagnostics = fileProblems.map((problem) => {
                    const range = new vscode.Range(Number(problem.lineNumber) - 1, Number(problem.columnNumber) - 1, Number(problem.lineNumber) - 1, Number(problem.columnNumber) - 1);

                    return new vscode.Diagnostic(range, problem.problem.replace(/ {1}\([0-9]+:[0-9]+\)$/, ''));
                });

                diagnosticCollection.set(vscode.Uri.file(path.join(this.workspace, file)), diagnostics);
            });
        }
    }
}

function activate(context) {
    output.appendLine('CodePointe is now active!');

    let deploy = null;

    let deployTimeout = null;

    let fullDeploy = false;

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (filePath) => {
        try {
            const workspacePath = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath.fileName)).uri.fsPath;

            const exists = fs.existsSync(path.join(workspacePath, '.sfdx'));

            if (!exists) return;

            const relativeFilePath = path.join('.', filePath.fileName.replace(workspacePath, ''));

            const sfRegexFullCompile = /\.object$|\.permissionset$/;

            const sfRegexFullCompileMatch = relativeFilePath.match(sfRegexFullCompile);

            const sfRegex = /\.page$|\.component$|\.cls$|\.trigger$|\.layout$|\.resource$|\.remoteSite$|\.labels$|\.app$|\.dashboard$|\.workflow$|\.email$|\.profile$|\.scf$|\.queue$|\.reportType$|\.report$|\.weblink$|\.tab$|\.letter$|\.role$|\.homePageComponent$|\.homePageLayout$|\.objectTranslation$|\.flow$|\.datacategorygroup$|\.snapshot$|\.site$|\.sharingRules$|\.settings$|\.callCenter$|\.community$|\.authProvider$|\.customApplicationComponent$|\.quickAction$|\.approvalProcess$|\.apxc$|\.apxt$/;

            const sfRegexMatch = relativeFilePath.match(sfRegex);

            const resourceRegex = /\w*\.resource/;

            const resourceRegexMatch = relativeFilePath.match(resourceRegex);

            // do a full deploy as a workaround for sfdx deploy not handling custom objects or permission sets correctly
            if (sfRegexFullCompileMatch || fullDeploy) {
                fullDeploy = true;

                deploy = new Deploy(workspacePath);
            } else if (sfRegexMatch) {
                if (!deploy) deploy = new Deploy(workspacePath);

                deploy.addSfFile(relativeFilePath);
            } else if (resourceRegexMatch) {
                if (!deploy) deploy = new Deploy(workspacePath);

                deploy.addBundle(path.join(resourceRegexMatch[0]));

                deploy.addSfFile(path.join(workspacePath, 'src', 'staticresources', resourceRegexMatch[0]));
            }

            if (deploy) {
                clearTimeout(deployTimeout);

                deployTimeout = setTimeout(() => {
                    output.appendLine('======================================================================================================================================================');

                    if (fullDeploy) {
                        output.appendLine('compiling project');

                        deploy.runCompileProject();
                    } else {
                        output.appendLine('deploying files');

                        deploy.run();
                    }

                    deploy = null;

                    fullDeploy = false;
                }, 100);
            }
        } catch (err) {
            output.appendLine(err);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('codePointe.compileProject', async () => {
        try {
            for(let workspaceFolder of vscode.workspace.workspaceFolders) {
                const exists = fs.existsSync(path.join(workspaceFolder.uri.fsPath, '.sfdx'));

                if (!exists) continue;

                output.appendLine('======================================================================================================================================================');

                output.appendLine('compiling project');

                const projectDeploy = new Deploy(workspaceFolder.uri.fsPath);

                await projectDeploy.runCompileProject();
            }
        } catch (err) {
            output.appendLine(err);
        }
    }));
}
exports.activate = activate;

function deactivate() {
}
exports.deactivate = deactivate;
