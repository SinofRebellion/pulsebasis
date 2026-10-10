# Authorship & proof

PulseBasis was conceived and created by **@sinofrebellion** (https://x.com/sinofrebellion) and launched on **October 10, 2026** at https://pulsebasis.netlify.app.

## What is proven

`proof/STATEMENT.txt` states the authorship and lists the SHA-256 hashes of the launch release:

| File | SHA-256 |
|---|---|
| `pulsebasis-source-2026-10-10.tar` | `a107d2741f972de45d8dbdcbc9026f168e4aede57c5dec322eaf631e2a706453` |
| `pulsebasis-dist-2026-10-10.tar` | `a7295860b34a10d101592b81368e8deff3464b88d62a02a6f96b2082d94f1642` |
| `dist/index.html` | `ea457667b1eca0410b5ca817fb5e00ab96bcc1507637c9e2adc0448e96d04cb4` |
| `dist/stats.html` | `17fadfde6688b6c026f95833643c642dc9ecbfa7dd1b0c21351da97d91ca183e` |
| `dist/assets/jsx-runtime-WV6yfsf0.js` | `96becca382fac55aaf73a9df67f9742af23595ea768942798002a915ecc7d615` |
| `dist/assets/main-BG_XMzM1.js` | `291141b71ee5afbc55356b4e753fa1add5593f9b2a6635f79cebc7ff0d30042a` |
| `dist/assets/stats-DhnTeo0W.js` | `d09d8937c40de6571d1bc65c45e52646a25b02354027054c251b70974ca98e1e` |
| `dist/assets/worker-DahSlhLH.js` | `0aa3918ba502ee79c6857eef49246185eb10f353bc045e5a7a5af881e7385819` |

`proof/STATEMENT.txt.ots` is an [OpenTimestamps](https://opentimestamps.org) proof of that statement. It is anchored in the Bitcoin blockchain, which proves the statement (and therefore these exact files) existed no later than the Bitcoin block it is committed to. The stamp was submitted on 2026-10-10; Bitcoin confirmation takes a few hours, after which `ots upgrade proof/STATEMENT.txt.ots` embeds the full Bitcoin attestation in the file.

The two tarballs are deterministic (`tar --sort=name --mtime=2026-10-10T00:00:00Z --owner=0 --group=0 --numeric-owner`) and are kept with the release.

## How to verify

```sh
pip install opentimestamps-client           # the free 'ots' client
ots upgrade proof/STATEMENT.txt.ots         # once, after Bitcoin confirmation
ots verify  proof/STATEMENT.txt.ots         # checks the statement against Bitcoin (needs a Bitcoin node, or use opentimestamps.org)
sha256sum -c proof/SHA256SUMS               # run next to the tarballs / built files
```

Without a Bitcoin node, drag `STATEMENT.txt.ots` and `STATEMENT.txt` onto https://opentimestamps.org to verify in the browser.
