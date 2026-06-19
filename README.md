# Microsoft Teams Bot Action for GitHub

This GitHub Action allows you to send proactive messages to a Microsoft Teams channel via the Bot Framework API. It is especially useful for CI/CD pipelines or any automated process where you want to notify your team directly in Teams.

---

## Dependencies & Setup

To use this GitHub Action, you must configure several Microsoft Azure and Teams components:

### 1. Azure App Registration

- Go to [Azure Portal](https://portal.azure.com) → "App registrations"
- Create a new application, or request it to be registered for you (depending on your org. setup and processes) that will represent the bot identity
- Mark down for later:
  - `Application (client) ID`
  - `Directory (tenant) ID`

### 2. Microsoft Bot Service

## Creating a Bot Service (Infrastructure as Code)

It is strongly recommended to manage the bot infrastructure using Infrastructure as Code (IaC).

Because this action uses a proactive messaging bot (not a full conversational bot), the required Azure resources are minimal and can be created with a relatively small Terraform configuration.

### Example Terraform configuration

```hcl
resource "azurerm_resource_group" "bot_rg" {
  name     = var.resource_group_name
  location = var.location
}

# Bot Channels Registration
resource "azurerm_bot_service_azure_bot" "bot" {
  name                = var.bot_name
  location            = var.bot_location
  resource_group_name = azurerm_resource_group.bot_rg.name

  sku                     = var.bot_sku
  display_name            = var.bot_display_name
  microsoft_app_id        = var.bot_app_id
  microsoft_app_type      = var.bot_app_type
  microsoft_app_tenant_id = var.bot_tenant_id

  tags = {
    env    = "prod"
    system = "notifications"
  }
}

# Enable Microsoft Teams channel for the bot
data "azurerm_client_config" "current" {}

resource "azurerm_bot_channel_ms_teams" "teams" {
  bot_name            = azurerm_bot_service_azure_bot.bot.name
  location            = var.bot_location
  resource_group_name = azurerm_resource_group.bot_rg.name
}
```

### Required inputs

You must provide all required variables yourself.
The most important ones are:

- `subscription_id` (required by the AzureRM provider configuration, not directly by the bot resource)
- `bot_app_id`
- `bot_tenant_id`

These values come from an Azure App Registration, which represents the bot identity.

At a minimum, you need:

- an Azure subscription
- an App Registration in Entra ID

The Terraform code above:

- creates a dedicated resource group
- deploys an Azure Bot Service
- enables the Microsoft Teams channel for the bot

All other variables (names, SKU, locations, tags) can be chosen freely according to your environment and conventions.

> **Note** > `microsoft_app_type` is typically `"SingleTenant"` for enterprise/internal bots.

### 3. Add Bot to Teams

- Create a new app. In Teams go to **Apps -> Developer Portal**
- Click **Create a new app** Give it a name and use latest Manifest version
- After app is created go to **Branding** and upload icons for your bot app
- Go to **App package editor** and update manifest.json
  - at **developer** section provide required information. Urls might be a dummy ones.
  - update **description** accordingly
  - add **bots** section:

  ```json
   "bots": [
    {
      "botId": "<Your Entra ID App registration ID>",
      "scopes": [
        "groupChat",
        "team"
      ],
      "isNotificationOnly": true,
      "supportsCalling": false,
      "supportsVideo": false,
      "supportsFiles": false
    }
  ]
  ```

  - everything else might be left by default
  - Do not confuse these IDs:

    **id** (root of manifest) is the Teams App package ID and will be pre-generated for you.
    **bots[].botId** must be the Entra ID Application (client) ID of the bot.

  - save changes
  - Click at **Preview in Teams**
  - Follow the instructions and add your app to the target Microsoft Teams team.
    This step is required so the bot is allowed to post messages into the team’s channels.
  - Example of full manifest.json:

  ```json
  {
    "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.22/MicrosoftTeams.schema.json",
    "version": "1.0.0",
    "manifestVersion": "1.22",
    "id": "14771909-b752-45ff-b7ad-19fdd74fa461",
    "name": {
      "short": "cf-notifications-bot"
    },
    "developer": {
      "name": "Cloud Foundation",
      "websiteUrl": "https://yourdomain.com",
      "privacyUrl": "https://yourdomain.com/privacy",
      "termsOfUseUrl": "https://yourdomain.com/terms"
    },
    "description": {
      "short": "A chat bot to deliver messages to teams",
      "full": "Chat Bot, which uses federation credentials to deliver messages from github actions to teams group chat"
    },
    "icons": {
      "outline": "outline.png",
      "color": "color.png"
    },
    "accentColor": "#FFFFFF",
    "bots": [
      {
        "botId": "<Your Entra ID App registration ID>",
        "scopes": ["groupChat", "team"],
        "isNotificationOnly": true,
        "supportsCalling": false,
        "supportsVideo": false,
        "supportsFiles": false
      }
    ],
    "validDomains": []
  }
  ```

### 4. Federated Credentials (GitHub OIDC)

Keyless access to the bot service from GitHub or other sources.
Go to your App Registration → "Certificates & secrets" → "Federated credentials":

- Federated credential scenario: Other issuer
- Issuer: `https://token.actions.githubusercontent.com`
- Audience: make sure it is set to **api://AzureADTokenExchange** (this is required for GitHub OIDC)
- Value: **Claims matching expression**, you can use a filtered expression like:

```
claims['sub'] matches 'repo:your-org/team-repo-prefix-*:ref:refs/heads/*'
```

If you use environments at github you might want to add this claim as well:

```
claims['sub'] matches 'repo:your-org/team-repo-prefix-*:environment:*'
```

This allows any repo and each branch of that repo under your org and prefixed with `team-repo-prefix-` to use this token.
You may want to restrict this further (for example to a single repository or environment) for security reasons.

---

## Token Authentication Note

GitHub’s federated tokens cannot be exchanged via standard OBO (on-behalf-of) flows due to Microsoft restrictions.

Instead, this action uses a **JWT client assertion flow**, where the GitHub-issued OIDC token is presented as a client assertion.

---

## Required Repository Secrets

Secret names are arbitrary; the example below assumes these names.

| Secret Name        | Description                                       |
| ------------------ | ------------------------------------------------- |
| `AZURE_CLIENT_ID`  | Client ID of your Azure App registration          |
| `AZURE_TENANT_ID`  | Tenant ID of your Azure directory                 |
| `TEAMS_CHANNEL_ID` | Channel ID in Microsoft Teams to send messages to |

---

## Inputs

This action accepts the following inputs:

| Input        | Description                           | Required |
| ------------ | ------------------------------------- | -------- |
| `message`    | Message text to post to Teams         | Yes      |
| `tenant-id`  | Your bot's app tenant id              | Yes      |
| `client-id`  | Your bot's app client ID              | Yes      |
| `channel-id` | Microsoft Teams channel ID to send to | Yes      |

---

## Example Usage

```yaml
name: Send Teams Message via Action

on:
  workflow_dispatch:
    inputs:
      message:
        description: 'Message to send'
        required: true
        default: 'Testing ms teams message send action from external repo'

jobs:
  notify-teams:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    steps:
      - name: Use Action to Send Message
        uses: metro-digital/teams-bot-notify-action@v0
        with:
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          channel-id: ${{ secrets.TEAMS_CHANNEL_ID }}
          message: ${{ github.event.inputs.message }}
```

---

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
