# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Audio transcription (OpenRouter)

This project now includes a local backend endpoint for audio transcription:

- API server: `server/transcription-server.mjs`
- Endpoint: `POST /api/transcriptions`
- Default model: `mistralai/voxtral-small-24b-2507`

Setup:

1. Create `.env` from `.env.example`
2. Set `OPENROUTER_API_KEY`
3. Set `EXPO_PUBLIC_TRANSCRIBE_API_URL`

Run:

```bash
npm run api
npm run start
```

Environment notes:

- Android emulator usually needs `EXPO_PUBLIC_TRANSCRIBE_API_URL=http://10.0.2.2:4001`
- iOS simulator can use `http://localhost:4001`
- Physical device must use your machine LAN IP (e.g. `http://192.168.x.x:4001`)

Audio limits for test mode:

- Max file size: `TRANSCRIBE_MAX_FILE_MB` (default `5`)

Quality controls:

- `TRANSCRIBE_HINTS`: comma-separated vocabulary hints (brand names, people, product terms).
- `TRANSCRIBE_POSTPROCESS=true`: optional extra AI pass for spelling/punctuation cleanup.
- `OPENROUTER_POSTPROCESS_MODEL`: model for cleanup pass.
- `OPENROUTER_ENRICH_MODEL`: model used to generate title + summary from transcript.
- `OPENROUTER_OCR_MODEL`: model used to extract literal text from photos.
  - Current default: `mistralai/mistral-small-3.1-24b-instruct:free` (free tier)

Photo workflow:

- Photos are saved by capture event (`photoGroupId`).
- You can capture multiple photos before saving the full group.
- After saving, OCR runs automatically per photo.
- OCR output is tuned for medical prescriptions: returns full visible recipe text (including medications, indications, doctor and institution data when visible).

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
