# Demo video: voice-over script

The final video is `video/qrac-demo.mp4` (3:15, 1920x1080, H.264 with AAC voice, no music, 86 MB). The version without voice is `video/qrac-demo-silent.mp4`. Both are kept outside git because of their size. The lines are also in `video/qrac-demo.srt`. Each subtitle was written to be read aloud: read each line inside its time window, and the voice and the subtitles match.

| Time | Line |
|---|---|
| 0:00.6 | QRAC.me: post-quantum accounts for Ethereum, working today and ready for EIP-8141. |
| 0:05.9 | This is QRAC.me in Brave. We start in Dev mode, where every step is visible. |
| 0:13.6 | We create a 24-word seed, saved as a file. It is never sent anywhere. |
| 0:19.3 | Brave Wallet connects on Sepolia. It only pays gas, with no control over the account. |
| 0:26.0 | From the seed: 1,024 one-time hash-based keys (LMS). This is the post-quantum part. |
| 0:31.7 | We mint the account through our factory. One confirmation, about 738k gas. |
| 0:39.7 | Then we fund it with 0.02 Sepolia ETH. |
| 0:47.7 | On Etherscan: our account is a contract, holding 0.02 ETH. |
| 0:57.7 | Now we send 0.001 ETH back to the Brave wallet. |
| 1:03.7 | The review checks that what we sign is, byte for byte, what the contract verifies. |
| 1:12.7 | Signed with one-time key #0. Brave just delivers it and pays the gas. |
| 1:23.5 | Etherscan: Brave sent the transaction, and the account paid out 0.001 ETH. |
| 1:29.3 | No ECDSA key can move these funds. Only the post-quantum key can. |
| 1:35.4 | Now the future: EIP-8141 frame transactions, on the public devnet. |
| 1:41.1 | A throwaway setup key gets devnet ETH. It only pays to create and fund the account. |
| 1:48.6 | Same seed, new keys for this chain. We mint the account and fund it. |
| 1:57.1 | We sign a frame transaction: one post-quantum signature, zero ECDSA. |
| 2:01.9 | The check needs about 250k gas, and the account pays its own gas. |
| 2:07.1 | The public mempool allows only 100k gas for validation. Rejected. |
| 2:13.2 | Each send uses a fresh one-time key, which is also an EIP-8250 nonce key. |
| 2:19.1 | The ERC-8421 alternative mempool admits it: 17 of 17 checks. Mined. |
| 2:29.1 | The explorer agrees: on chain, the account is the payer, every rule passed. |
| 2:38.1 | Same accounts in User mode: a simple wallet anyone can use. |
| 2:46.1 | Send, and every step shows live, from the signature to the block. |
| 3:01.8 | And on Sepolia, the account we made in Dev mode: 1,015 one-time keys left. |
| 3:07.1 | QRAC.me: post-quantum accounts for Ethereum, today. Try it at qrac.me. |

## Recording the voice

- Play the video muted and read each line when its subtitle appears. Short pauses are fine.
- Windows Sound Recorder is enough. Any format works (m4a, mp3 or wav), one file for the whole video.
- No music: ETHGlobal asks for audio without music.
- The voice file is then mixed into the final MP4 with the same editor that made the video.

The voice-over was recorded with a small local page that plays the video muted, shows each line and records the microphone in sync. The take was trimmed to the video start, gently compressed and normalized (speech median about -15 dBFS, no clipping), and the closing card was lengthened by 2 seconds so the last line is not cut.

## How the video was made

- Recorded in Brave with Brave Wallet, on a local copy of the site with the same files as qrac.me. Claude drove the site through the Claude browser extension; the team unlocked the wallet and confirmed every wallet request.
- Real transactions: Sepolia (mint, fund, a PQ-signed transfer, each shown on Etherscan) and the EIP-8141 devnet (frame transactions, shown on the alt-mempool explorer).
- The screen was captured at 15 frames per second with a small Windows script, and edited in the browser (WebCodecs and mp4-muxer): dead time cut or sped up, a zoom on each step, English subtitles.
- On the devnet the first frame transaction was dropped by the network (see `docs/FEEDBACK-ALT-MEMPOOL.md`, item 6); the video shows the next one, signed with the next one-time key and mined.
