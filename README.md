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

  In case you need to add your app to a private channel you have to use manifest schema of at least version 1.25 and
  `supportsChannelFeature` set to `tier1`:

  ```json
  {
    "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.25/MicrosoftTeams.schema.json",
    "manifestVersion": "1.25",
    ...
    "supportsChannelFeatures": "tier1"
  }
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
    "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.25/MicrosoftTeams.schema.json",
    "version": "1.1.0",
    "manifestVersion": "1.25",
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
        "botId": "<YOUR-ENTRA-APP-ID>",
        "scopes": ["groupChat", "team"],
        "isNotificationOnly": true,
        "supportsCalling": false,
        "supportsVideo": false,
        "supportsFiles": false
      }
    ],
    "validDomains": [],
    "supportsChannelFeatures": "tier1"
  }
  ```

### 4. Federated Credentials (GitHub OIDC)

GitHub Actions authenticates to the bot application by using OpenID Connect (OIDC), so no client secret or long-lived key is required.

Go to your App Registration → **Certificates & secrets** → **Federated credentials** and create a new credential with:

- Federated credential scenario: **Other issuer**
- Issuer: `https://token.actions.githubusercontent.com`
- Audience: **api://AzureADTokenExchange**
- Type: **Claims matching expression**

For GitHub flexible federated credentials, Microsoft requires the expression to match the `sub` claim together with at least one immutable GitHub identifier:

- `repository_id` — immutable ID of one specific repository
- `repository_owner_id` — immutable ID of the repository owner / GitHub organization

For setups where multiple repositories share a naming prefix, `repository_owner_id` is usually the better fit because it allows us to keep wildcard matching on the repository name while still anchoring the trust to the immutable GitHub organization ID.

For example, to allow all repositories prefixed with `team-repo-prefix-` and all branches:

```text
claims['sub'] matches 'repo:your-org/team-repo-prefix-*:ref:refs/heads/*' and claims['repository_owner_id'] eq 'YOUR_ORG_ID'
```

If the GitHub workflows use environments, add a second credential for environment-based subjects:

```text
claims['sub'] matches 'repo:your-org/team-repo-prefix-*:environment:*' and claims['repository_owner_id'] eq 'YOUR_ORG_ID'
```

This means that a matching token must satisfy both conditions:

1. the workflow must come from a repository matching the expected organization and repository prefix; and
2. the repository must still belong to the same immutable GitHub organization ID.

The second check matters because organization and repository names are mutable, while GitHub's numeric owner and repository IDs are stable. This prevents a renamed, transferred, or later re-created repository from accidentally matching a trust rule based only on names.

If you want to restrict access to a single repository instead of a family of repositories, you can use `repository_id` instead of `repository_owner_id`.

You can obtain `repository_owner_id` and `repository_id` from the GitHub OIDC token issued during a workflow run. Typical claims look like:

```json
{
  "repository": "your-org/team-repo-prefix-service",
  "repository_id": "123456789",
  "repository_owner": "your-org",
  "repository_owner_id": "98765432"
}
```

The GitHub OIDC token must therefore be treated as the source of truth when configuring these immutable IDs.

---

## Token Authentication Note

GitHub’s federated tokens cannot be exchanged via standard OBO (on-behalf-of) flows due to Microsoft restrictions.

Instead, this action uses a **JWT client assertion flow**, where the GitHub-issued OIDC token is presented as a client assertion.

---

## Required Repository Configuration

This action receives all configuration through action inputs. The examples below use GitHub Actions secrets and variables to provide those input values.

The names of the GitHub secrets and variables are only examples. You may use different names in your repository as long as your workflow maps them to the correct action inputs.

### Secrets or Variables

The Azure IDs are not client secrets. They are identifiers. Store them as GitHub secrets or variables according to your organization's policy.

| Example Name      | Description                              |
| ----------------- | ---------------------------------------- |
| `AZURE_CLIENT_ID` | Client ID of your Azure App registration |
| `AZURE_TENANT_ID` | Tenant ID of your Azure directory        |

### Variables

The Teams channel ID is not a credential, so the recommended default is to store it as a GitHub Actions variable.

| Example Name       | Description                                       |
| ------------------ | ------------------------------------------------- |
| `TEAMS_CHANNEL_ID` | Channel ID in Microsoft Teams to send messages to |

---

## Inputs

This action accepts the following inputs:

| Input        | Description                                                                                                                                                                                                                       | Required |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `message`    | Message text to post to Teams                                                                                                                                                                                                     | Yes      |
| `as-card`    | Wraps the plain message text inside a single Adaptive Card TextBlock. It does not support buttons, facts, columns, images, or multiple text blocks — it changes how the message renders (card vs. plain text), not its structure. | No       |
| `tenant-id`  | Your bot's app tenant id                                                                                                                                                                                                          | Yes      |
| `client-id`  | Your bot's app client ID                                                                                                                                                                                                          | Yes      |
| `channel-id` | Microsoft Teams channel ID to send to                                                                                                                                                                                             | Yes      |

---

## Example Usage

### Plain text

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
          channel-id: ${{ vars.TEAMS_CHANNEL_ID }}
          message: ${{ github.event.inputs.message }}
```

### Adaptive Card

```yaml
name: Notify Teams

on:
  pull_request:
  push:
    branches: [master]

jobs:
  notify-teams:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      # This example uses an additional step to build the message instead of receiving it as input
      # Builds message for PR and push to master gh events
      # Using printf so that line breaks are taken into account
      - name: Build Teams message
        id: build_message
        env:
          PR_AUTHOR: ${{ github.event.pull_request.user.login }}
          PR_PROJECT: ${{ github.event.pull_request.base.repo.name }}
          PR_TITLE: ${{ github.event.pull_request.title }}
          PR_URL: ${{ github.event.pull_request.html_url }}
          PUSH_AUTHOR: ${{ github.actor }}
          PUSH_PROJECT: ${{ github.event.repository.name }}
          PUSH_COMMIT_MSG: ${{ github.event.head_commit.message }}
          PUSH_COMMIT_URL: ${{ github.event.head_commit.url }}
        run: |
          if [ "${{ github.event_name }}" = "pull_request" ]; then
            MSG=$(printf 'PR submitted by **%s**\n\nProject: **%s**\n\n**%s** --> [link](%s)' \
              "$PR_AUTHOR" \
              "$PR_PROJECT" \
              "$PR_TITLE" \
              "$PR_URL")
          elif [ "${{ github.event_name }}" = "push" ] && [ "${{ github.ref }}" = "refs/heads/master" ]; then
            MSG=$(printf 'Push to master submitted by **%s**\n\nProject: **%s**\n\n**%s** --> [link](%s)' \
              "$PUSH_AUTHOR" \
              "$PUSH_PROJECT" \
              "$PUSH_COMMIT_MSG" \
              "$PUSH_COMMIT_URL")
          else
            MSG=""
          fi

          {
            echo "message<<EOF"
            echo "$MSG"
            echo "EOF"
          } >> "$GITHUB_OUTPUT"

      - name: Notify Teams
        if: steps.build_message.outputs.message != ''
        uses: metro-digital/teams-bot-notify-action@v0
        with:
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          channel-id: ${{ secrets.TEAMS_CHANNEL_ID }}
          message: ${{ steps.build_message.outputs.message }}
          as-card: 'true'
```

---

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
