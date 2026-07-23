# Silent Signal

Silent Signal is a stealth-oriented emergency alert system designed for situations where a user cannot safely ask for help out loud. The app disguises itself as a normal notes workspace while quietly collecting location and audio evidence, notifying trusted contacts, and preserving data through weak connectivity.

## Current capabilities

- JWT-authenticated API flow with duress-PIN login support
- Login and SOS endpoint rate limiting
- Alternate triggers: gesture pattern, shake gesture, whispered safe word, and a browser-level power-button style visibility sequence
- Auto-expiring evidence links for trusted contacts
- Offline GPS queue with reconnect flush using batched uploads
- Throttled GPS polling when the device appears stationary
- Chunked audio uploads every 30 seconds
- PWA caching for faster decoy UI startup
- AI-assisted confirmation logic that only suggests a countdown and never auto-fires SOS directly
- AI-generated plain-English incident summaries from stored evidence
- AI-seeded decoy notes to make the notes UI feel lived in

## Threat model

Silent Signal is meant for covert distress signaling, not for replacing emergency services or hardened native-device controls.

### Assumptions

- The user has already created an account and added trusted contacts.
- The browser has permission to access location and microphone when needed.
- The user can safely keep the decoy app installed as a PWA or browser tab.
- Network connectivity may be intermittent, so evidence must survive offline periods.

### Defenses this project now focuses on

- Preventing easy account or SOS abuse with JWT auth and rate limiting
- Keeping the decoy UI believable enough to avoid immediate suspicion
- Preserving evidence during flaky connectivity by batching and replaying GPS uploads
- Avoiding AI-triggered false alarms by requiring agreement across multiple signals and always using a user-cancellable countdown
- Rotating public evidence access through expiring share links

### Important limits

- The "power-button" trigger is a browser approximation based on visibility changes, not true hardware-button interception.
- Safe-word detection depends on browser speech-recognition support and can be unreliable in noisy environments.
- This is still a web app, so OS-level stealth and background execution are weaker than a native mobile app.
- Audio evidence is stored server-side and is not end-to-end encrypted from the server operator.
- Duress-PIN login is intentionally immediate; other non-duress triggers use the disguised countdown to reduce false alarms.

## Environment variables

Configure these in `.env`:

- `JWT_SECRET`: required for stable auth tokens
- `ENCRYPTION_KEY`: 64-char hex key for encrypted GPS storage
- `DATABASE_PATH`: optional path for the runtime SQLite DB, defaults to `data/silent_signal.db`
- `APP_URL`: public base URL for evidence links
- `EVIDENCE_TTL_HOURS`: expiry window for shared evidence links
- `GEMINI_API_KEY`: optional, enables seeded decoy notes and incident reports
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`: optional SMS alerts
- `RESEND_API_KEY` or SMTP credentials: optional email alerts

## Local development

```bash
npm install
npm run dev
```

4. **Testing the Stealth Mode**:
   - Register a new account.
   - Set a **Normal Password** and a **Duress PIN**.
   - Log out and log back in using the **Duress PIN**.
   - Observe the server logs (or the hidden debug indicator in `App.tsx`) to see the SOS activation.

## 📂 Project Structure

- `/server.ts`: Express server with SQLite integration.
- `/src/App.tsx`: Main application logic and background SOS tasks.
- `/src/components/Login.tsx`: Stealth login interface.
- `/src/components/Dashboard.tsx`: Decoy notes application and settings.
- `/src/types.ts`: TypeScript interfaces for data consistency.

## 🔗 Inspiration & Resources

- [Web Geolocation API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)
- [MediaRecorder API Guide](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream_Recording_API)
- [Example SOS App (GitHub)](https://github.com/search?q=emergency+sos+app+react)

---

*Built for National Hackathon 2026 by Team INGENIOUS.*
