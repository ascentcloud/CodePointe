# Apex Watch

Apex Watch is meant to fill the gap between MavensMate and Salesforce's VS Code extension pack for the metadata source file structure. It includes features such as:
- Automatically deploy Salesforce files on save
- Automatically zip and deploy resource bundles when a file within the bundle is saved
- Full project compile with resource bundles included

## Package and Install

Install vsce

```
npm install -g vsce
```

Navigate to the folder where Apex Watch is and package the extension

```
cd <Apex Watch Folder>
vsce package
```

To install the extension use the command "Extensions: Install from VSIX" inside of VS Code and then find the `.vsix` file and install it.

## How To Use

Follow the steps to install the [Salesforce Extension Pack](https://marketplace.visualstudio.com/items?itemName=salesforce.salesforcedx-vscode) and make sure it can deploy individual files to your org (right click a Salesforce file then click "SFDX: Deploy Source To Org"). The Salesforce Extension Pack handles setting up SFDX for your org and Apex Watch simply uses these same settings.

After installing Apex Watch there should be a "Apex Watch: Compile Project" command which zips all `resource-bundles/*.resource` folders and creates their `src/staticresources/*.resource` files and then does a full deploy of everything in the `src` folder.

Apex Watch watches for save events on any files with Salesforce extensions and deploys them individually.

Apex Watch also watches for save events to any files within `*.resource` folders and will zip and deploy the resource bundle for you.

Details for any deploys can be found under VS Code output after selecting the "Apex Watch" output channel.

## Hooks

Custom scripts can be run from specific hooks within Apex Watch. The hooks include: before/after zipping bundles, before/after deploying files, and before/after a full project compile. These custom scripts should be added to a file called `.apex-watch.js` which you will need to place in the root of your workspace. Note that your scripts should use async functions or return a promise if you want them to finish before the deploy continues. An object is passed to each function when they are called that inculdes: `workspace` a string with the full path to your workspace, `bundles` an array of resource bundles included in this deploy (bundle name and .resource extension only, no path), and `sfFiles` an array of paths, relative to your workspace, to salesforce files being deployed (not populated on a full project compile).

`.apex-watch.js` should look like:

```
module.exports = (function () {
	async function beforeZipBundle(data) {
		// code here
	}

	async function afterZipBundle(data) {
		// code here
	}

	async function beforeDeployFiles(data) {
		// code here
	}

	async function afterDeployFiles(data) {
		// code here
	}

	async function beforeProjectCompile(data) {
		// code here
	}

	async function afterProjectCompile(data) {
		// code here
	}

	return {
		beforeZipBundle,
		afterZipBundle,
		beforeDeployFiles,
		afterDeployFiles,
		beforeProjectCompile,
		afterProjectCompile
	};
})();
```
