const vscode = require('vscode');
const spawn = require('child_process').spawn;
const path = require('path');
const _ = require('lodash');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));

const output = vscode.window.createOutputChannel('CodePointe');

const diagnosticCollection = vscode.languages.createDiagnosticCollection('CodePointe');

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

class Deploy {
    constructor(workspace) {
        this.workspace = workspace;

        this.bundles = [];

        this.sfFiles = [];
    }

    get deployData() {
        return _.cloneDeep(this);
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
            await exec(`zip -FSr ${path.join(this.workspace, 'src', 'staticresources', bundle)} .`, {cwd: path.join(this.workspace, 'resource-bundles', bundle), console: false});
        }

        await this.runUserScript('afterZipBundle');
    }

    async run() {
        try {
            diagnosticCollection.clear();

            await this.zipBundles();

            await this.runUserScript('beforeDeployFiles');

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `deploying: ${this.sfFiles.join(',')}`,
                cancellable: false
            }, exec.bind(null, `sfdx force:source:deploy --json -p ${this.sfFiles.join(',')}`, {cwd: this.workspace}));

            await this.runUserScript('afterDeployFiles');

            output.appendLine('deploy complete');

            output.hide();
        } catch (err) {
            output.appendLine(`failed to deploy: ${this.sfFiles.join(',')}`);

            vscode.window.showErrorMessage(`failed to deploy: ${this.sfFiles.join(',')}`);

            const errorMessage = JSON.parse(err);

            const problemsByFile = _.groupBy(errorMessage.result, 'filePath');

            _.forEach(problemsByFile, (fileProblems, file) => {
                const diagnostics = fileProblems.map((problem) => {
                    const range = new vscode.Range(Number(problem.lineNumber) - 1, Number(problem.columnNumber) - 1, Number(problem.lineNumber) - 1, Number(problem.columnNumber) - 1);

                    return new vscode.Diagnostic(range, problem.error.replace(/ {1}\([0-9]+:[0-9]+\)$/, ''));
                });

                diagnosticCollection.set(vscode.Uri.file(path.join(this.workspace, file)), diagnostics);
            });

            output.show();
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

            await exec('rm -rf .codepointecompile', {cwd: this.workspace});

            await this.runUserScript('beforeProjectCompile');

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `converting project to sfdx format`,
                cancellable: false
            }, exec.bind(null, `sfdx force:mdapi:convert --rootdir ${path.join('src')} --outputdir ${path.join('.codepointecompile')}`, {cwd: this.workspace, console: false}));

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `deploying project to salesforce`,
                cancellable: false
            }, exec.bind(null, `sfdx force:source:deploy -p ${path.join('.codepointecompile')}`, {cwd: this.workspace}));

            await exec('rm -rf .codepointecompile', { cwd: this.workspace });

            await this.runUserScript('afterProjectCompile');

            output.appendLine('project compile complete');

            output.hide();
        } catch (err) {
            output.appendLine('project compile failed');

            vscode.window.showErrorMessage('project compile failed');

            output.show();
        }
    }
}

function activate(context) {
    output.appendLine('CodePointe is now active!');

    let deploy = null;

    let deployTimeout = null;

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (filePath) => {
        try {
            const workspacePath = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath.fileName)).uri.fsPath;

            const relativeFilePath = path.join('.', filePath.fileName.replace(workspacePath, ''));

            const sfRegex = /\.page$|\.component$|\.cls$|\.object$|\.trigger$|\.layout$|\.resource$|\.remoteSite$|\.labels$|\.app$|\.dashboard$|\.permissionset$|\.workflow$|\.email$|\.profile$|\.scf$|\.queue$|\.reportType$|\.report$|\.weblink$|\.tab$|\.letter$|\.role$|\.homePageComponent$|\.homePageLayout$|\.objectTranslation$|\.flow$|\.datacategorygroup$|\.snapshot$|\.site$|\.sharingRules$|\.settings$|\.callCenter$|\.community$|\.authProvider$|\.customApplicationComponent$|\.quickAction$|\.approvalProcess$|\.apxc$|\.apxt$/;

            const sfRegexMatch = relativeFilePath.match(sfRegex);

            const resourceRegex = /\w*\.resource/;

            const resourceRegexMatch = relativeFilePath.match(resourceRegex);

            if (sfRegexMatch) {
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

                    output.appendLine('deploying files');

                    deploy.run();

                    deploy = null;
                }, 100);
            }
        } catch (err) {
            output.appendLine(err);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('extension.compileProject', async () => {
        try {
            for(let workspaceFolder of vscode.workspace.workspaceFolders) {
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
