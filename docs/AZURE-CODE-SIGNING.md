# Azure Artifact Signing — code-sign the Windows installer

The NSIS `.exe` and MSI produced by the release workflow are **unsigned**, which is
why Windows shows *"Windows protected your PC — Unknown publisher"* (SmartScreen).
This doc explains how to sign them with **Azure Artifact Signing** (Microsoft's
cloud code-signing service, formerly *Trusted Signing*) so the publisher name is
real and SmartScreen stops blocking.

The signing is **fully optional and automatic**: the workflow contains the signing
steps, but they only run when the Azure secrets exist. With no secrets configured,
builds stay unsigned exactly as they are today.

---

## How the workflow behaves

| Secrets configured? | Build result |
|---|---|
| No (current state) | Unsigned installer — SmartScreen warns, users click **More info → Run anyway** |
| Yes (this doc) | Installers signed with your certificate — *Publisher: \<your name\>* shows in the dialog, SmartScreen trust builds over time |

Re-runs of the same tag re-sign and overwrite the release assets automatically.

---

## Quick reference — recommended values (use these exact names)

| What | Value | Goes to secret |
|---|---|---|
| Resource group | `yt-downloader` | — |
| Signing account | `ytdl-signing` | `AZURE_SIGNING_ACCOUNT` |
| Region | **East US** | — |
| Endpoint | `https://eus.codesigning.azure.net/` | `AZURE_SIGNING_ENDPOINT` |
| Certificate profile | `ytdl-code-signing` | `AZURE_CERT_PROFILE` |
| App registration | `yt-downloader-gh-actions` | `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` |

Using these exact values means every secret maps to the workflow with no guesswork.

---

## One-time Azure setup (~30–60 minutes, free tier)

> **Checkpoint 1** — after step 2 (certificate profile creation), identity
> validation can take a few hours to a day. Pause here until the profile shows
> **Active**; signing fails until then.

### 1. Create the Artifact Signing resource

1. Go to [portal.azure.com](https://portal.azure.com) → search **"Artifact Signing"** → **Create**.
2. Choose a subscription + resource group, an **Account name** (e.g. `ytdl-signing`), and a **Region**.
   - Pick the region nearest you; you'll need the region's **endpoint** in step 6.
   - Pricing: free tier for individual / non-commercial use (Individual validation);
     Organization validation is ~$10/month. Solo open-source devs: **Individual** is enough.
3. Create the resource. Open it and copy the **endpoint** from the Overview page
   (e.g. `https://eus.codesigning.azure.net/` for East US).

### 2. Create a certificate profile

1. Inside the signing resource → **Certificate profiles** → **Create**.
2. **Profile name**: e.g. `ytdl-code-signing` (this becomes `AZURE_CERT_PROFILE`).
3. **Trusted Signing type**: *Public Trust*.
4. **Certificate profile**: *Code Signing - Individual Validation* (solo) or
   *Code Signing - Organization Validation*.
5. Enter your identity details — **this is the publisher name that will appear in
   SmartScreen** ("Publisher: Your Name" instead of "Unknown publisher").
6. Submit. Identity validation can take a few hours to a day — the profile shows
   **Active** when ready.

### 3. Register an app in Microsoft Entra ID (for OIDC auth)

1. Search **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Name it `yt-downloader-gh-actions`, leave the rest default, **Register**.
3. From the app's Overview page, copy:
   - **Application (client) ID** → `AZURE_CLIENT_ID`
   - **Directory (tenant) ID** → `AZURE_TENANT_ID`
   - Your Azure **Subscription ID** (Azure portal → Subscriptions) → `AZURE_SUBSCRIPTION_ID`

### 4. Add a federated credential so GitHub Actions can log in

1. In the app registration → **Certificates & secrets** → **Federated credentials** → **Add credential**.
2. **Scenario**: *GitHub Actions deploying Azure resources*.
3. **Issuer**: `https://token.actions.githubusercontent.com` (auto-filled).
4. Create **two** credentials (GitHub's OIDC subject is ref-specific):
   - **Entity**: *Tag* — Organization `simplearyan`, Repository `yt-downloader`, Tag `v*`
   - **Entity**: *Branch* — Organization `simplearyan`, Repository `yt-downloader`, Branch `main`
5. Save both. (This is what lets the workflow get a short-lived token with no stored passwords.)

### 5. Grant the signing role (critical)

1. Back in the **Artifact Signing** resource → **Access control (IAM)** → **Add role assignment**.
2. **Role**: `Artifact Signing Certificate Profile Signer`.
3. **Member**: search and select the `yt-downloader-gh-actions` app registration.
4. Review + assign. **Without this role, signing fails** with a permissions error.

### 6. Add the GitHub Actions secrets

Go to the repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `AZURE_CLIENT_ID` | Application (client) ID from step 3 |
| `AZURE_TENANT_ID` | Directory (tenant) ID from step 3 |
| `AZURE_SUBSCRIPTION_ID` | Your Azure subscription ID |
| `AZURE_SIGNING_ENDPOINT` | Endpoint from step 1 — `https://eus.codesigning.azure.net/` (East US) |
| `AZURE_SIGNING_ACCOUNT` | Signing account name — `ytdl-signing` |
| `AZURE_CERT_PROFILE` | Certificate profile name — `ytdl-code-signing` |

> **Checkpoint 2** — once the profile is **Active** and all six secrets are added,
> tell the assistant: it will push the next version tag, confirm the signing steps
> ran in CI, and verify the signature (Part 4 below).

---

## Part 4 — verify end-to-end (after secrets are added)

1. **Trigger a signed build**: push a new tag, e.g.

   ```bash
   git tag v0.1.2-beta && git push origin v0.1.2-beta
   ```

   (or run the workflow manually from the Actions tab).
2. **Confirm the signing steps ran** — in the run's job, both steps must appear and
   pass (they're skipped when secrets are absent):
   - `Azure login (code signing)`
   - `Sign installers with Azure Artifact Signing`
3. **Check the release note flipped** from *"Unsigned build…"* to
   *"Code-signed with Azure Artifact Signing."*
4. **Verify the signature on the downloaded installer** — PowerShell:

   ```powershell
   Get-AuthenticodeSignature .\YouTube.Downloader_0.1.2_x64-setup.exe | Format-List Status, StatusMessage, SignerCertificate
   ```

   Expected: `Status = Valid`, and `SignerCertificate.Subject` contains your
   publisher name (not "Unknown").
5. **Human check**: right-click the installer → **Properties → Digital
   Signatures** → the signature and your name should be listed.

---

## Verify a signed installer (quick)

- **Properties → Digital Signatures** on the downloaded file — signature + publisher name visible.
- CLI: `signtool verify /pa /v YouTube.Downloader_x64-setup.exe`
- PowerShell: `Get-AuthenticodeSignature .\file.exe | Format-List Status, SignerCertificate`

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Unable to find certificate profile` | Missing **Artifact Signing Certificate Profile Signer** role (step 5), or the `AZURE_SIGNING_ENDPOINT` region doesn't match the account's region |
| OIDC 401 / login fails | Federated credential subject doesn't match the ref — both **Tag `v*`** and **Branch `main`** credentials must exist (step 4) |
| `AZURE_SIGNING_ACCOUNT` not found | Secret value is the account *name* (`ytdl-signing`), not its resource ID |
| Signing "succeeds" but SmartScreen still warns | New certificates need **reputation** — see below |

## SmartScreen after signing

- The *"Unknown publisher"* line disappears immediately — the dialog now shows your name.
- SmartScreen may still show a **reduced** warning for a brand-new certificate until
  enough people install it (reputation). It fades with downloads.
- Only paid **EV certificates** (DigiCert/Sectigo, ~$200–500/yr) get *instant* trust
  with no reputation period. Not worth it for this project yet.

---

## Checklist (copy-paste tracker)

- [ ] Artifact Signing resource created (`ytdl-signing`, East US)
- [ ] Certificate profile `ytdl-code-signing` created and shows **Active**
- [ ] App registration `yt-downloader-gh-actions` created (IDs copied)
- [ ] Two federated credentials added (Tag `v*` + Branch `main`)
- [ ] `Artifact Signing Certificate Profile Signer` role assigned to the app
- [ ] All six `AZURE_*` secrets added to the repo
- [ ] Signed build triggered and both signing steps passed in CI
- [ ] `Get-AuthenticodeSignature` → `Status = Valid` with publisher name

---

### Related

- [RELEASE-WORKFLOW-PLAN.md](./RELEASE-WORKFLOW-PLAN.md) — how installers get built and released
- [PROFESSIONAL-INSTALL-PLAN.md](./PROFESSIONAL-INSTALL-PLAN.md) — full roadmap to a warning-free install
- Azure docs: [Set up signing integrations (GitHub Actions)](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)
- Action: [Azure/artifact-signing-action](https://github.com/Azure/artifact-signing-action)
