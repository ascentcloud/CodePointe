# NateMate README

## Package and Install

Install vsce

```
npm install -g vsce
```

Navigate to the folder where NateMate is and package the extension

```
cd <NateMate Folder>
vsce package
```

To install the extension use the command "Extensions: Install from VSIX" inside of VS Code and then find the `.vsix` file and install it.

## How To Use

Follow the steps to install the [Salesforce Extension Pack](https://marketplace.visualstudio.com/items?itemName=salesforce.salesforcedx-vscode) and make sure it can deploy individual files to your org (right click a Salesforce file then click "SFDX: Deploy Source To Org"). The Salesforce Extension Pack handles setting up SFDX for your org and NateMate simply uses these same settings.

After installing NateMate there should be a "NateMate: Compile Project" command which zips all `resource-bundles/*.resource` folders and creates their `src/staticresources/*.resource` files and then does a full deploy of everything in the `src` folder.

NateMate watches for save events on any files with Salesforce extensions and deploys them individually.

NateMate also watches for save events to any files within `*.resource` folders and will zip and deploy the resource bundle for you.

Details for any deploys can be found under VS Code output after selecting the "NateMate" output channel.
