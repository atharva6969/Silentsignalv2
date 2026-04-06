# Silent Signal — Stealth Emergency Alert System

**Silent Signal** is a high-stakes safety application designed for situations where a victim cannot openly call for help. It uses a "Duress PIN" system to silently trigger emergency protocols while maintaining a decoy interface to avoid detection by a perpetrator.

## 🚀 Key Features

- **Multi-Modal Stealth Trigger**:
  - **Duress PIN**: Log in with a secret secondary PIN to trigger SOS silently.
  - **Decoy Interface**: The app transforms into a fully functional "Notes" application during an emergency.
- **Background SOS Engine**:
  - **Live GPS Tracking**: Continuous location sharing with trusted contacts.
  - **Silent Audio Recording**: Captures ambient audio as evidence without any visual or audible indicators.
- **Privacy-First Architecture**:
  - **No Installation Trace**: Built as a Progressive Web App (PWA).
  - **Encrypted Storage**: All evidence and contact data are stored securely.
- **Zero Notification Leak**: Suppresses all system notifications and sounds during an active SOS.

## 🛠️ Technical Stack

- **Frontend**: React 19, Tailwind CSS, Motion, Lucide Icons.
- **Backend**: Node.js (Express), SQLite (Better-SQLite3).
- **APIs**: Geolocation API, MediaRecorder API.

## 📦 Setup Instructions

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Variables**:
   Create a `.env` file (or use the one provided in AI Studio) and set:
   - `GEMINI_API_KEY`: For future AI-powered threat detection features.
   - `APP_URL`: The URL where the app is hosted.

3. **Run the Application**:
   ```bash
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
