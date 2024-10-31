const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand, GetTranscriptionJobCommand, StartTranscriptionJobCommand } = require('@aws-sdk/client-s3');
const { TranscribeClient } = require('@aws-sdk/client-transcribe');
const { v4: uuidv4 } = require('uuid');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { Readable } = require('stream');
require('dotenv').config();
const Transcription = require('../models/Transcription');

const AWS_ACCESS_KEY_ID_DEV = process.env.AWS_ACCESS_KEY_ID_DEV;
const AWS_SECRET_ACCESS_KEY_DEV = process.env.AWS_SECRET_ACCESS_KEY_DEV;
const AWS_REGION_DEV = process.env.AWS_REGION_DEV;

// Create S3 client
const s3Client = new S3Client({
  region: AWS_REGION_DEV,
  endpoint: 'https://s3.us-east-1.amazonaws.com',
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID_DEV,
    secretAccessKey: AWS_SECRET_ACCESS_KEY_DEV,
  },
});

// Create Transcribe client
const transcribeClient = new TranscribeClient({
  region: AWS_REGION_DEV,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID_DEV,
    secretAccessKey: AWS_SECRET_ACCESS_KEY_DEV,
  },
});

const upload = multer();
const uploadRouter = express.Router();

uploadRouter.post('/', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  const bucketName = 'ayudabucket';
  const s3Key = `${uuidv4()}-${req.file.originalname}`;

  try {
    // Upload audio file to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    console.log('File uploaded to S3:', s3Key);

    // Start transcription job
    const transcriptionJobName = uuidv4();
    const transcribeParams = {
      TranscriptionJobName: transcriptionJobName,
      LanguageCode: 'en-US',
      Media: {
        MediaFileUri: `https://${bucketName}.s3.${AWS_REGION_DEV}.amazonaws.com/${s3Key}`,
      },
      MediaFormat: req.file.originalname.split('.').pop(),
      OutputBucketName: bucketName,
      Settings: {
        ShowSpeakerLabels: true,
        MaxSpeakerLabels: 2
      }
    };

    await transcribeClient.send(new StartTranscriptionJobCommand(transcribeParams));
    console.log('Transcription job started:', transcriptionJobName);

    const transcriptionResult = await checkTranscriptionJobStatus(transcriptionJobName);

    if (transcriptionResult) {
      const transcription = new Transcription(transcriptionResult);
      const savedTranscription = await transcription.save();
      console.log('Transcription saved to MongoDB:', savedTranscription);

      return res.json({ transcription: savedTranscription });
    } else {
      return res.status(500).json({ message: 'Transcription failed.' });
    }

  } catch (error) {
    console.error('Error uploading file or starting transcription:', error);
    res.status(500).send('Error processing the file.');
  }
});

async function checkTranscriptionJobStatus(transcriptionJobName) {
  let jobCompleted = false;
  let transcriptionResult = '';

  while (!jobCompleted) {
    await new Promise(resolve => setTimeout(resolve, 5000));

    const jobStatusResponse = await transcribeClient.send(
      new GetTranscriptionJobCommand({ TranscriptionJobName: transcriptionJobName })
    );

    const jobStatus = jobStatusResponse.TranscriptionJob.TranscriptionJobStatus;
    console.log('Transcription job status:', jobStatus);

    if (jobStatus === 'COMPLETED') {
      const transcriptUri = jobStatusResponse.TranscriptionJob.Transcript.TranscriptFileUri;
      transcriptionResult = await fetchTranscriptionJson(transcriptUri);
      jobCompleted = true;
    } else if (jobStatus === 'FAILED') {
      console.error('Transcription job failed.');
      jobCompleted = true;
    }
  }

  return transcriptionResult;
}

async function fetchTranscriptionJson(transcriptUri) {
  const url = new URL(transcriptUri);
  const pathSegments = url.pathname.split('/').filter(segment => segment);
  const bucketName = pathSegments[0];
  const key = pathSegments.slice(1).join('/');

  try {
    const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
    const data = await s3Client.send(command);

    const streamToString = (stream) => {
      return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        stream.on('error', reject);
      });
    };

    const jsonString = await streamToString(data.Body);
    const transcriptJson = JSON.parse(jsonString);

    if (transcriptJson.results && transcriptJson.results.transcripts.length > 0) {
      const transcriptText = transcriptJson.results.transcripts[0].transcript;
      const speakerLabels = transcriptJson.results.speaker_labels || [];

      const speakerSegments = speakerLabels.segments.map(segment => ({
        speaker: segment.speaker_label,
        startTime: segment.start_time,
        endTime: segment.end_time,
        content: transcriptJson.results.items
          .filter(item => item.start_time >= segment.start_time && item.end_time <= segment.end_time)
          .map(item => item.alternatives[0].content)
          .join(' ')
      }));

      return { transcript: transcriptText, speakerSegments };
    } else {
      console.error('Transcript not found in the response.');
      return null;
    }
  } catch (error) {
    console.error('Error fetching transcription JSON:', error);
    return null;
  }
}

module.exports = uploadRouter;
