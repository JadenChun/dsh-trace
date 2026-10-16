# Publish this prepared Git repository

The repository was prepared locally. The GitHub repository **has not been created** yet.

1. On your signed-in GitHub account, create a new **empty** repository named `dsh-trace-studio` at https://github.com/new. Select **Private** initially if you will be testing against real agent traces. Do **not** initialize it with a README, .gitignore, or license: those files are already in this project.
2. Extract the ZIP and change into the `dsh-trace-studio` directory. It contains an initial Git commit on `main`.
3. Run:

   ```bash
   git remote add origin https://github.com/JadenChun/dsh-trace-studio.git
   git push -u origin main
   ```

   Authenticate to GitHub with an approved credential manager, SSH remote, or the GitHub CLI. Do not paste an access token into scripts, chat, or the repository.

4. Verify the repository's `README.md` displays screenshots, and then install it with the local `link:` command in the README. Publishing or deploying to a public production DSH server is not recommended until you have reviewed the security notes and verified the plugin against your installed DSH version.

If your actual target GitHub owner/repository differs, update the remote URL before pushing.
