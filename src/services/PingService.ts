import * as AWS from 'aws-sdk';
import { GetObjectRequest, PutObjectRequest } from 'aws-sdk/clients/s3';
import EnvVars from '@src/constants/EnvVars';
const pingTimes: { time: string, url: string }[] = [];



// Configure the AWS region and credentials
const s3 = new AWS.S3({
  region: EnvVars.AwsCredentials.Region,
  accessKeyId: EnvVars.AwsCredentials.AccessKey,
  secretAccessKey: EnvVars.AwsCredentials.Secret,
});

const bucketName = 'd174712b-8f46-4a97-84c0-044a03f465e1-logs';
// const logMessage = 'This is a log message\n';

async function appendLogToS3File(installId: string, logMessage: string) {
  try {
    // Check if the bucket exists and create it if it doesn't
    const headBucketParams = { Bucket: bucketName };
    try {
      await s3.headBucket(headBucketParams).promise();
    } catch (error) {
      if (error.statusCode === 404) {
        // Bucket does not exist, so create it
        console.log(`Bucket ${bucketName} does not exist. Creating bucket...`);
        await s3.createBucket({ Bucket: bucketName }).promise();
        console.log(`Bucket ${bucketName} created successfully.`);
      } else {
        // Some other error occurred
        throw error;
      }
    }

    // Get the existing content from the S3 object
    const getObjectParams = {
      Bucket: bucketName,
      Key: installId,
    };

    let existingContent = '';
    try {
      const data = await s3.getObject(getObjectParams).promise();
      existingContent = data.Body?.toString('utf-8') || '';
    } catch (getObjectError) {
      // Handle case where the object does not exist yet
      if (getObjectError.code !== 'NoSuchKey') {
        throw getObjectError;
      }
    }

    // Append the new log message
    existingContent += logMessage;

    // Write the updated content back to the S3 object
    const putObjectParams = {
      Bucket: bucketName,
      Key: installId,
      Body: existingContent,
    };

    await s3.putObject(putObjectParams).promise();
  } catch (error) {
    console.error('Error in appendLogToS3File:', error);
  }
}
// Run the function


const ping = (time: string, url: string) => {
  pingTimes.push({ time, url });
  return pingTimes;
};

const writeLogs = (installId: string, logs: Record<string, string>) => {
  const concatLogs = Object.values(logs).join("\n");
  appendLogToS3File(installId, concatLogs);

}

export default {
  ping,
  writeLogs
} as const;
