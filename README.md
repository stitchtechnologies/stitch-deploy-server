# api.stitch.tech

Stitch makes deploying services to customer clouds easier.

This repo is for the Stitch backend API which manages the creation of deployments and updating their status.

## ⚙️ Setup

1. Clone this repo from GitHub
2. Run `yarn` to install all dependencies
3. Populate the root `.env` file with the following environment variables:

```
DATABASE_URL="postgres db url"
SENDGRID_API_KEY="sendgrid api key for sending confirmation emails"
AWS_REGION="aws region for s3 logs"
AWS_ACCESS_KEY="aws access key for s3 logs"
AWS_SECRET="aws region for s3 logs"
```
4. Run `yarn dev` to start the service locally in development mode.
5. Run `yarn build` and then `yarn start` to start in production mode.


## Contributing

Any contributions you make are greatly appreciated.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue. Don't forget to give the project a star!

1. Fork the Project
2. Create your Feature Branch (git checkout -b feature/AmazingFeature)
3. Commit your changes (git commit -m 'Add some AmazingFeature')
4. Push to the Branch (git push origin feature/AmazingFeature)
5. Open a Pull Request

## Contact

[Join our Slack!](https://join.slack.com/t/stitchsupport/shared_invite/zt-2d839m41h-qYy7ZTJ1mRec7zYw4Pl9oQ)