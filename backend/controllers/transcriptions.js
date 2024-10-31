const transcriptionRouter = require('express').Router()
const Transcription = require('../models/transcription')

transcriptionRouter.post('/', async (request, response) => {
    const body = request.body

    const transcription = new Transcription({
        transcript: body.transcript,
        speakerSegments: body.speakerSegments,
        createdAt: body.createdAt || Date.now()
    })

    try {
        const savedTranscription = await transcription.save()
        response.status(201).json(savedTranscription)
    } catch (error) {
        response.status(400).json({ error: 'Error saving transcription' })
    }
})

// GET route to retrieve all transcriptions
transcriptionRouter.get('/', async (request, response) => {
    try {
        const transcriptions = await Transcription.find({})
        response.json(transcriptions)
    } catch (error) {
        response.status(500).json({ error: 'Error retrieving transcriptions' })
    }
})

module.exports = transcriptionRouter;
