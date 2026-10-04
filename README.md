# GitHub Flow Manager

A full-stack web application designed to manage GitHub repositories, edit files, and upload ZIP archives using GitHub's OAuth system and API.

## Project Setup

1. **Install Dependencies**:
   \`\`\`bash
   npm install
   \`\`\`

2. **Run the Application**:
   \`\`\`bash
   npm run dev
   \`\`\`
   Navigate to \`http://localhost:3000\` to use your application.

3. **Authentication**:
   - Go to your GitHub Settings -> Developer Settings -> Personal access tokens (Classic).
   - Click "Generate new token (classic)".
   - Select the \`repo\` scope to allow reading and writing repositories.
   - Use the generated token to log into the application.

## Technologies Used
- Frontend: React 19, Tailwind CSS v4, vite, lucide-react 
- Backend: Express, express-session, multer, adm-zip, axios
