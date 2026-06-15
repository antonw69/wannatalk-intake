import { File } from "node:buffer";

globalThis.File = File;

import express from "express";

import cors from "cors";

import multer from "multer";

import fs from "fs";

import path from "path";

import dotenv from "dotenv";

import OpenAI from "openai";

import pkg from "pg";

const { Pool } = pkg;

dotenv.config();

const app = express();

app.use(

    cors({

        origin: [

            "https://dashboard.wannatalk.co.za",

            "https://intake.wannatalk.co.za",

            "http://localhost:3000",

            "http://localhost:4200"
        ],

    })

);

const upload = multer({ dest: "uploads/" });
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

app.use(express.static("public"));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

function getTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureFolder(folder) {
    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
    }
}

function ensureStorageFolders() {
    ensureFolder("uploads");
    ensureFolder("saved_voice_notes");
    ensureFolder("saved_transcripts");
    ensureFolder("saved_analysis");
    ensureFolder("saved_text_intakes");
}

function requireAdmin(req, res, next) {
    const auth = req.headers.authorization;

    if (!auth || !auth.startsWith("Basic ")) {
        res.setHeader("WWW-Authenticate", "Basic realm=\"WannaTalk Admin\"");
        return res.status(401).send("Authentication required");
    }

    const base64 = auth.replace("Basic ", "");
    const decoded = Buffer.from(base64, "base64").toString("utf8");
    const [username, password] = decoded.split(":");

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        return next();
    }

    return res.status(403).send("Invalid login");
}

async function analyseIntake({ selectedLanguage, rawText, intakeType }) {
    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            {
                role: "system",
                content: `
You are an intake assistant for WannaTalk.

Rules:
* Do not diagnose.
* Do not invent facts.
* Only use information explicitly stated or strongly implied.
* If information is unavailable use “Unknown” or an empty array.
* Be concise.
* Identify risk signals clearly.
* Return JSON only.

Definitions:

what_they_are_going_through:
Briefly describe the person's primary situation, difficulty, distress, or reason for seeking help. Keep this short and human-readable.

how_long_feeling_this_way:
Extract any timeframe mentioned by the person.

Examples:
- two weeks
- three months
- since last year
- for a while

If no timeframe is mentioned, use "Unknown".

feels_safe_now:
Determine whether the person appears safe right now based only on what they say.

Possible values:
- yes
- no
- unsure
- unknown

Use:
- yes: only if the person clearly indicates they are safe.
- no: if the person indicates immediate danger, intent to self-harm, suicidal intent, violence, abuse, or serious risk.
- unsure: if the person expresses significant distress, confusion, impaired functioning, possible admission need, severe emotional struggle, or uncertainty about safety.
- unknown: if safety is not mentioned and no safety concern is strongly implied.

preferred_support:
Identify the type of support requested, preferred, or most strongly implied.

Possible values:
- facilitator
- counsellor
- psychologist
- psychiatrist
- social worker
- support group
- existing provider
- unknown

Guidance:
- If the person explicitly requests a support type, use that.
- If the person asks to speak to "someone" or wants general emotional support without clear clinical treatment, consider facilitator.
- If the person mentions an existing psychologist, therapist, counsellor, doctor, or ongoing sessions but the exact profession is unclear, use existing provider.
- If the person mentions psychological therapy, therapy sessions, mental health treatment, depression, anxiety, trauma, or emotional difficulty, consider psychologist.
- If the person discusses psychiatric medication, medication review, admission, psychiatric treatment, severe addiction, active suicidal thoughts, crisis intervention, or possible hospitalisation, consider psychiatrist.
- If social circumstances, family welfare, abuse, neglect, housing, child protection, or social support are central, consider social worker.
- If there is insufficient information, return "unknown".

risk_level:
Classify the overall risk level.

Possible values:
- low
- medium
- high
- urgent
- unknown

Guidance:
- low: general support request, no clear distress or risk indicators.
- medium: emotional distress, anxiety, depression, functional difficulty, confusion, medication concerns, or need for follow-up, but no immediate danger disclosed.
- high: significant distress, severe impaired functioning, possible abuse, self-harm thoughts, suicidal thoughts without immediate intent, severe substance use, aggression, or escalating risk.
- urgent: immediate danger, active suicidal intent, active self-harm intent, violence, medical emergency, psychosis with danger, or person says they are not safe.
- unknown: insufficient information.

risk_flags:
Specific risk indicators mentioned or strongly implied.

Examples:
- self-harm thoughts
- suicidal thoughts
- immediate danger
- abuse
- substance use
- substance dependence
- impulsive behaviour
- theft
- aggression
- severe distress
- inability to function normally
- confusion
- medication concerns
- possible admission need

presenting_concerns:
Capture ALL primary concerns described by the person.

Include:
- emotions
- symptoms
- behaviours
- life difficulties
- mental health concerns
- substance use concerns

Examples:
- anxiety
- depression
- suicidal thoughts
- addiction
- panic attacks
- grief
- confusion
- loneliness
- difficulty communicating
- difficulty functioning
- difficulty getting through the day
- relationship conflict
- work stress
- medication concern

Do not limit the list to a single concern when multiple concerns are present.

risk_factors:
Identify all factors increasing vulnerability, distress, or risk.

Include:
- emotional distress
- impaired functioning
- substance dependence
- suicidal thinking
- social isolation
- medication concerns
- trauma
- abuse
- financial stress
- relationship difficulties
- severe addiction
- lack of support

If a factor contributes to worsening wellbeing, include it.

protective_factors:
Actively look for protective factors.

Common protective factors include:
- seeking help
- contacting WannaTalk
- willingness to talk
- treatment engagement
- previous counselling
- existing therapist
- existing therapeutic relationship
- medication compliance
- family support
- partner support
- employment
- faith
- future goals
- willingness to attend appointments
- requesting follow-up

If a person voluntarily submits an intake or asks for help, include "seeking help" unless evidence suggests otherwise.

reviewer_considerations:
Items a facilitator, counsellor, psychologist, psychiatrist, social worker, or healthcare professional should explore further.

Always provide at least one reviewer consideration if mental health concerns, distress, medication concerns, impaired functioning, confusion, ongoing treatment, substance use, suicidal thoughts, or safety uncertainty are mentioned.

Examples:
- assess severity of anxiety and depression
- assess current safety and risk
- assess suicide risk immediately
- assess substance dependence severity
- assess impact on daily functioning
- explore medication effectiveness
- consider medication review
- clarify existing treatment relationship
- determine whether psychologist or psychiatrist review is needed
- explore support network
- assess whether urgent escalation is required
- clarify whether admission is being considered
- determine immediate safety needs

administrative_next_steps:
Operational actions for the WannaTalk team.

Examples:
- contact patient
- schedule follow-up session
- assign facilitator
- assign psychologist
- assign psychiatrist
- assign social worker
- arrange medication review
- provide crisis resources
- escalate for urgent review
- confirm availability for appointment
- update case status to under review

themes:
Broad emotional, behavioural, or life themes.

Examples:
- anxiety
- depression
- trauma
- grief
- relationships
- stress
- loneliness
- addiction
- medication concerns
- work stress
- mental health support
- treatment follow-up
- impaired functioning
- emotional distress
- crisis support

keywords:
Important words and phrases appearing in the intake. Use short, relevant phrases from or closely based on the person's words.

Important extraction rules:
- Populate ALL arrays whenever relevant information exists.
- Do not leave arrays empty if meaningful information can reasonably be extracted.
- If a person is actively requesting help, include "seeking help" as a protective factor.
- If a person mentions previous sessions, therapy, counselling, psychology, medical treatment, or ongoing care, include "treatment engagement" or "existing therapeutic relationship" as a protective factor.
- If a person mentions still taking medication, include "medication compliance" as a protective factor.
- If medication is not working, needs review, or is part of the concern, include "medication concerns" as a risk factor.
- Ongoing anxiety or depression should normally be included as risk factors.
- Difficulty getting through the day, difficulty functioning, or struggling to cope should normally be included as a risk factor.
- Active suicidal thoughts, self-harm intent, or immediate danger should normally result in risk_level "urgent".
- Severe addiction with suicidal thoughts should normally result in preferred_support "psychiatrist".
- Confusion or difficulty talking should normally be included as a presenting concern and may be included as a risk flag if clinically relevant.
- Do not diagnose. Extract and organise only what is stated or strongly implied.

INTAKE VALIDITY ASSESSMENT

Before determining presenting concerns, risk factors,

support needs, reviewer considerations, preferred support,

or risk level:

Determine whether the person is:

- Actively seeking help

- Requesting support

- Describing a current personal difficulty

- Sharing information only

- Having a casual conversation

- Telling a story

- Discussing another person

- Testing the system

Do not classify casual conversation,

storytelling, demonstrations, jokes,

hypothetical examples or testing recordings

as clinical concerns unless the speaker clearly

describes them as their own current difficulties

requiring support.

help_request_detected:

true =

The person appears to be seeking help,

support, guidance or intervention.

false =

No clear request for help is present.

intake_validity:

valid

possible_test

casual_conversation

third_party_discussion

hypothetical_example

unclear

engagement_type:

help_seeking

information_sharing

casual_conversation

storytelling

testing

hypothetical

unclear

confidence_score:

A value between 0 and 100 indicating confidence

in the classification.

If the recording appears to be a test,

casual conversation or demonstration:

help_request_detected = false

requires_human_review = false

risk_level should not be elevated solely

because emotional or mental health terms

were mentioned conversationally.

Return this exact JSON structure:
{
    "detected_language": "",

    "intake_type": "",

    "help_request_detected": false,

    "intake_validity": "",

    "engagement_type": "",

    "confidence_score": 0,

    "summary": "",

    "what_they_are_going_through": "",

    "how_long_feeling_this_way": "",

    "feels_safe_now": "",

    "preferred_support": "",

    "risk_level": "",

    "risk_flags": [],

    "presenting_concerns": [],

    "emotions_detected": [],

    "background_factors": [],

    "risk_factors": [],

    "protective_factors": [],

    "strengths_identified": [],

    "reviewer_considerations": [],

    "administrative_next_steps": [],

    "themes": [],

    "keywords": [],

    "cleaned_text": "",

    "requires_human_review": false
}
`
            },
            {
                role: "user",
                content: `
Selected language: ${selectedLanguage}
Intake type: ${intakeType}

Text:
${rawText}
`
            }
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
    });

    try {
        return JSON.parse(completion.choices[0].message.content || "{}");
    } catch {
        return {
            detected_language: selectedLanguage,

            intake_type: intakeType,

            help_request_detected: false,

            intake_validity: "unclear",

            engagement_type: "unclear",

            confidence_score: 0,

            cleaned_text: rawText,

            summary: "Analysis unavailable",

            what_they_are_going_through: "",

            how_long_feeling_this_way: "",

            feels_safe_now: "unknown",

            preferred_support: "unknown",

            risk_level: "unknown",

            risk_flags: [],

            presenting_concerns: [],

            emotions_detected: [],

            background_factors: [],

            risk_factors: [],

            protective_factors: [],

            strengths_identified: [],

            reviewer_considerations: [],

            administrative_next_steps: [],

            themes: [],

            keywords: [],

            requires_human_review: true
        };
    }
}
async function saveIntakeToDatabase({

    intakeType,

    nameAndSurname,

    contactNumber,

    email,

    consentToProcess,

    consentToContact,

    termsAccepted,

    termsVersion,

    selectedLanguage,

    rawText,

    analysis,

    audioFile,

    transcriptFile,

    analysisFile

}) {

    try {

        const referenceNumber =

            "WT-" + Date.now();

        const result = await pool.query(

            `

      INSERT INTO patient_intakes (

        full_name,

    contact_number,

    email,

    consent_to_process,

    consent_to_contact,

    terms_accepted,

    terms_version,

    terms_accepted_at,

    intake_type,

    selected_language,

    raw_text,

    cleaned_text,

    summary,

    preferred_support,

    feels_safe_now,

    risk_level,

    risk_flags,

    themes,

    keywords,

    audio_file,

    transcript_file,

    analysis_file,

    presenting_concerns,

    risk_factors,

    protective_factors,

    reviewer_considerations,

    administrative_next_steps,

    help_request_detected,

    intake_validity,

    engagement_type,

    confidence_score,

    emotions_detected,

    background_factors,

    strengths_identified,

    reference_number
      )

      VALUES (

        $1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP,

        $8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,

        $27,$28,$29,$30,$31,$32,$33,

        $34
      )
    RETURNING id
      `,

            [

                nameAndSurname,

                contactNumber,

                email,

                consentToProcess,

                consentToContact,

                termsAccepted,

                termsVersion,

                intakeType,

                selectedLanguage,

                rawText,

                analysis.cleaned_text || null,

                analysis.summary || null,

                analysis.preferred_support || null,

                analysis.feels_safe_now || null,

                analysis.risk_level || null,

                JSON.stringify(analysis.risk_flags || []),

                JSON.stringify(analysis.themes || []),

                JSON.stringify(analysis.keywords || []),

                audioFile || null,

                transcriptFile || null,

                analysisFile || null,

                JSON.stringify(analysis.presenting_concerns || []),

                JSON.stringify(analysis.risk_factors || []),

                JSON.stringify(analysis.protective_factors || []),

                JSON.stringify(analysis.reviewer_considerations || []),

                JSON.stringify(analysis.administrative_next_steps || []),

                analysis.help_request_detected ?? false,

                analysis.intake_validity || "unclear",

                analysis.engagement_type || "unclear",

                analysis.confidence_score || 0,

                JSON.stringify(analysis.emotions_detected || []),

                JSON.stringify(analysis.background_factors || []),

                JSON.stringify(analysis.strengths_identified || []),

                referenceNumber

            ]

        );

    } catch (err) {

        console.error("Database save error:", err);

    }

}
app.post("/transcribe", upload.single("audio"), async (req, res) => {
    let tempFile;

    try {
        ensureStorageFolders();

        if (!req.file) {
            return res.status(400).json({ success: false, error: "No audio file uploaded" });
        }

        const timestamp = getTimestamp();
        const selectedLanguage = req.body.language || "en";
        const nameAndSurname = req.body.name_and_surname || "Unknown";
        const contactNumber = req.body.contact_number || "Unknown";
        const email = req.body.email || null;

        const consentToProcess =

            req.body.consent_to_process === "true";

        const consentToContact =

            req.body.consent_to_contact === "true";

        const termsAccepted =

            req.body.terms_accepted === "true";

        const termsVersion =

            req.body.terms_version || "1.0";
        const originalExt = path.extname(req.file.originalname || "").toLowerCase() || ".webm";

        tempFile = req.file.path + originalExt;

        const savedAudioFile = path.join("saved_voice_notes", `voice-note-${timestamp}.webm`);
        const savedTranscriptFile = path.join("saved_transcripts", `transcript-${timestamp}.txt`);
        const savedAnalysisFile = path.join("saved_analysis", `analysis-${timestamp}.json`);

        fs.renameSync(req.file.path, tempFile);
        fs.copyFileSync(tempFile, savedAudioFile);
        console.log("STEP 1: file saved");

        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(tempFile),
            model: "gpt-4o-mini-transcribe",
            language: selectedLanguage,
            response_format: "json",
        });
        console.log("STEP 2: transcription complete");
        console.log("Transcript length:", (transcription.text || "").length);

        const rawTranscript = transcription.text || "";

        const analysis = await analyseIntake({
            selectedLanguage,
            rawText: rawTranscript,
            intakeType: "voice",
        });
        console.log("STEP 3: analysis complete");
        console.log("Transcript length:", (transcription.text || "").length);

        const transcriptContent = `
WannaTalk Voice Intake
Date/Time: ${new Date().toISOString()}

Name and Surname:
${nameAndSurname}

Contact Number:
${contactNumber}

Selected Language:
${selectedLanguage}

Saved Audio File:
${savedAudioFile}

RAW TRANSCRIPT:
${rawTranscript}

CLEANED TEXT:
${analysis.cleaned_text || "Not available"}

SUMMARY:
${analysis.summary || "Not available"}

EXTRACTED INFO:
Issue: ${analysis.what_they_are_going_through || "Unknown"}
Duration: ${analysis.how_long_feeling_this_way || "Unknown"}
Feels Safe Now: ${analysis.feels_safe_now || "Unknown"}
Preferred Support: ${analysis.preferred_support || "Unknown"}
Risk Level: ${analysis.risk_level || "Unknown"}
Risk Flags: ${(analysis.risk_flags || []).join(", ") || "None"}
Themes: ${(analysis.themes || []).join(", ") || "None"}
Keywords: ${(analysis.keywords || []).join(", ") || "None"}
`;

        fs.writeFileSync(savedTranscriptFile, transcriptContent, "utf8");

        fs.writeFileSync(
            savedAnalysisFile,
            JSON.stringify(
                {
                    date_time: new Date().toISOString(),
                    intake_type: "voice",
                    name_and_surname: nameAndSurname,
                    contact_number: contactNumber,
                    selected_language: selectedLanguage,
                    saved_audio_file: savedAudioFile,
                    saved_transcript_file: savedTranscriptFile,
                    raw_transcript: rawTranscript,
                    analysis,
                },
                null,
                2
            ),
            "utf8"
        );
        await saveIntakeToDatabase({

            intakeType: "voice",

            nameAndSurname,

            contactNumber,

            email,

            consentToProcess,

            consentToContact,

            termsAccepted,

            termsVersion,

            selectedLanguage,

            rawText: rawTranscript,

            analysis,

            audioFile: savedAudioFile,

            transcriptFile: savedTranscriptFile,

            analysisFile: savedAnalysisFile

        });

        console.log("STEP 4: database saved");
        if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        console.log("STEP 5: temp file deleted");

        console.log("STEP 6: returning success");

        res.json({
            success: true,
            message: "Thank you. Your voice note has been saved.",
            audioFile: path.basename(savedAudioFile),
            transcriptFile: path.basename(savedTranscriptFile),
            analysisFile: path.basename(savedAnalysisFile),
        });
    } catch (err) {
        console.error(err);

        if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        await saveIntakeToDatabase({
            intakeType: "text",
            nameAndSurname,
            contactNumber,
            selectedLanguage,
            rawText: message,
            analysis,
            audioFile: null,
            transcriptFile: savedTextFile,
            analysisFile: savedAnalysisFile
        });
        res.status(500).json({
            success: false,
            error: "Voice note could not be saved",
            details: err.message,
        });
    }
});
console.log("STEP 5: returning success");

app.post("/save-text-intake", async (req, res) => {
    try {
        ensureStorageFolders();

        const timestamp = getTimestamp();
        const message = req.body.text || req.body.message || "";
        const selectedLanguage = req.body.language || "en";
        const nameAndSurname = req.body.name_and_surname || "Unknown";
        const contactNumber = req.body.contact_number || "Unknown";
        const email = req.body.email || null;

        const consentToProcess =

            req.body.consent_to_process === true ||

            req.body.consent_to_process === "true";

        const consentToContact =

            req.body.consent_to_contact === true ||

            req.body.consent_to_contact === "true";

        const termsAccepted =

            req.body.terms_accepted === true ||

            req.body.terms_accepted === "true";

        const termsVersion =

            req.body.terms_version || "1.0";

        if (!message.trim()) {
            return res.status(400).json({ success: false, error: "No message provided" });
        }

        const savedTextFile = path.join("saved_text_intakes", `text-intake-${timestamp}.txt`);
        const savedAnalysisFile = path.join("saved_analysis", `text-analysis-${timestamp}.json`);

        const analysis = await analyseIntake({
            selectedLanguage,
            rawText: message,
            intakeType: "text",
        });

        const textContent = `
WannaTalk Text Intake
Date/Time: ${new Date().toISOString()}

Name and Surname:
${nameAndSurname}

Contact Number:
${contactNumber}

Selected Language:
${selectedLanguage}

ORIGINAL MESSAGE:
${message}

CLEANED TEXT:
${analysis.cleaned_text || "Not available"}

SUMMARY:
${analysis.summary || "Not available"}
`;

        fs.writeFileSync(savedTextFile, textContent, "utf8");

        fs.writeFileSync(
            savedAnalysisFile,
            JSON.stringify(
                {

                    date_time: new Date().toISOString(),

                    intake_type: "text",

                    name_and_surname: nameAndSurname,

                    contact_number: contactNumber,

                    selected_language: selectedLanguage,

                    saved_text_file: savedTextFile,

                    original_message: message,

                    analysis,

                },

                null,

                2

            ),

            "utf8"

        );

        await saveIntakeToDatabase({

            intakeType: "text",

            nameAndSurname,

            contactNumber,

            email,

            consentToProcess,

            consentToContact,

            termsAccepted,

            termsVersion,

            selectedLanguage,

            rawText: message,

            analysis,

            audioFile: null,

            transcriptFile: savedTextFile,

            analysisFile: savedAnalysisFile

        });

        res.json({

            success: true,

            message: "Thank you. Your message has been saved.",

            textFile: path.basename(savedTextFile),

            analysisFile: path.basename(savedAnalysisFile),
        });
    } catch (err) {
        console.error(err);

        res.status(500).json({
            success: false,
            error: "Text intake could not be saved",
            details: err.message,
        });
    }
});

app.post("/api/patient-intake", async (req, res) => {
    try {
        const data = req.body;

        const result = await pool.query(
            `
      INSERT INTO patient_intakes (
        full_name,
        contact_number,
        email,
        id_number,
        date_of_birth,
        age,
        emergency_contact_name,
        emergency_contact_number,
        preferred_support,
        current_concerns,
        duration,
        feels_safe_now,
        medical_history,
        medication,
        consent_to_process,
        consent_to_contact,
        raw_payload
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
      )
      RETURNING id, created_at
      `,
            [
                data.full_name || null,
                data.contact_number || null,
                data.email || null,
                data.id_number || null,
                data.date_of_birth || null,
                data.age || null,
                data.emergency_contact_name || null,
                data.emergency_contact_number || null,
                data.preferred_support || null,
                data.current_concerns || null,
                data.duration || null,
                data.feels_safe_now || null,
                data.medical_history || null,
                data.medication || null,
                data.consent_to_process === true || data.consent_to_process === "true",
                data.consent_to_contact === true || data.consent_to_contact === "true",
                data
            ]
        );

        res.json({
            success: true,
            message: "Patient intake saved successfully",
            intake_id: result.rows[0].id,
            created_at: result.rows[0].created_at
        });
    } catch (err) {
        console.error("Patient intake save error:", err);

        res.status(500).json({
            success: false,
            error: "Could not save patient intake",
            details: err.message
        });
    }
});

app.get("/api/admin/submissions", requireAdmin, (req, res) => {
    try {
        ensureStorageFolders();

        const audioFiles = fs.readdirSync("saved_voice_notes")
            .filter(file => file.endsWith(".webm"))
            .sort()
            .reverse();

        const transcriptFiles = fs.readdirSync("saved_transcripts")
            .filter(file => file.endsWith(".txt"));

        const analysisFiles = fs.readdirSync("saved_analysis")
            .filter(file => file.endsWith(".json"));

        const textFiles = fs.readdirSync("saved_text_intakes")
            .filter(file => file.endsWith(".txt"))
            .sort()
            .reverse();

        const voiceSubmissions = audioFiles.map(audioFile => {
            const stamp = audioFile.replace("voice-note-", "").replace(".webm", "");

            return {
                type: "voice",
                audioFile,
                transcriptFile: transcriptFiles.find(t => t.includes(stamp.substring(0, 16))) || "",
                analysisFile: analysisFiles.find(a => a.includes(stamp.substring(0, 16))) || "",
            };
        });

        const textSubmissions = textFiles.map(textFile => {
            const stamp = textFile.replace("text-intake-", "").replace(".txt", "");

            return {
                type: "text",
                audioFile: "",
                transcriptFile: textFile,
                analysisFile: analysisFiles.find(a => a.includes(stamp.substring(0, 16))) || "",
            };
        });

        res.json({ submissions: [...voiceSubmissions, ...textSubmissions] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Could not load submissions" });
    }
});

app.get("/api/admin/patient-intakes", requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `
      SELECT
        id,
        created_at,
        full_name,
        contact_number,
        email,
        preferred_support,
        current_concerns,
        feels_safe_now,
        status,
        presenting_concerns,
        risk_factors,
        protective_factors,
        reviewer_considerations,
        administrative_next_steps,
        cleaned_text,
        raw_text,
      FROM patient_intakes
      ORDER BY created_at DESC
      LIMIT 100
      `
        );

        res.json({
            success: true,
            intakes: result.rows,
        });
    } catch (err) {
        console.error("Patient intake list error:", err);

        res.status(500).json({
            success: false,
            error: "Could not load patient intakes",
            details: err.message,
        });
    }
});

app.get("/api/admin/audio/:filename", requireAdmin, (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join("saved_voice_notes", filename);

    if (!fs.existsSync(filePath)) return res.status(404).send("Audio not found");

    res.setHeader("Content-Type", "audio/webm");
    res.sendFile(path.resolve(filePath));
});

app.get("/api/admin/transcript/:filename", requireAdmin, (req, res) => {
    const filename = path.basename(req.params.filename);

    const voiceTranscriptPath = path.join("saved_transcripts", filename);
    const textIntakePath = path.join("saved_text_intakes", filename);

    let filePath = "";

    if (fs.existsSync(voiceTranscriptPath)) filePath = voiceTranscriptPath;
    else if (fs.existsSync(textIntakePath)) filePath = textIntakePath;
    else return res.status(404).send("Transcript not found");

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.sendFile(path.resolve(filePath));
});

app.get("/api/admin/analysis/:filename", requireAdmin, (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join("saved_analysis", filename);

    if (!fs.existsSync(filePath)) return res.status(404).send("Analysis not found");

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.sendFile(path.resolve(filePath));
});
app.get("/api/pilot-dashboard", async (req, res) => {

    try {

        const result = await pool.query(`

      SELECT

        id,

created_at,

full_name,

contact_number,

reference_number,

email,

intake_type,

risk_level,

primary_category,

preferred_support,

summary,

audio_file,

transcript_file,

analysis_file,

status,

assigned_to,

case_priority,

next_action,

reviewed_by,

reviewed_at,

transferred_to,

transferred_at,
presenting_concerns,

risk_factors,

protective_factors,

reviewer_considerations,

administrative_next_steps,

presenting_concerns,

risk_factors,

protective_factors,

reviewer_considerations,

administrative_next_steps,

help_request_detected,

intake_validity,

engagement_type,

confidence_score,

emotions_detected,

background_factors,

strengths_identified,

cleaned_text,

raw_text

    FROM patient_intakes

    WHERE COALESCE(status,'new') <> 'deleted'

    ORDER BY created_at DESC

    LIMIT 100

    `);

        res.json({

            success: true,

            intakes: result.rows

        });

    } catch (err) {

        console.error("Pilot dashboard error:", err);

        res.status(500).json({

            success: false,

            error: "Could not load dashboard"

        });

    }

});
app.get("/api/pilot-audio/:filename", (req, res) => {

    const filename = path.basename(req.params.filename);

    const filePath = path.join("saved_voice_notes", filename);

    if (!fs.existsSync(filePath)) return res.status(404).send("Audio not found");

    res.setHeader("Content-Type", "audio/webm");

    res.sendFile(path.resolve(filePath));

});

app.put("/api/intakes/:id/workflow", async (req, res) => {
    try {
        const { id } = req.params;
        const {
            status,
            case_priority,
            assigned_to,
            next_action,
            reviewer_notes,
            reviewed_by
        } = req.body;

        const result = await pool.query(
            `
      UPDATE patient_intakes
      SET
        status = COALESCE($1, status),
        case_priority = COALESCE($2, case_priority),
        assigned_to = COALESCE($3, assigned_to),
        next_action = COALESCE($4, next_action),
        reviewer_notes = COALESCE($5, reviewer_notes),
        reviewed_by = COALESCE($6, reviewed_by),
        reviewed_at = CASE
          WHEN $6 IS NOT NULL THEN CURRENT_TIMESTAMP
          ELSE reviewed_at
        END
      WHERE id = $7
      RETURNING *
      `,
            [status, case_priority, assigned_to, next_action, reviewer_notes, reviewed_by, id]
        );

        res.json({ success: true, intake: result.rows[0] });
    } catch (err) {
        console.error("Workflow update error:", err);
        res.status(500).json({ success: false, error: "Workflow update failed" });
    }
});
app.put("/api/intakes/:id/transfer", async (req, res) => {
    try {
        const { id } = req.params;
        const { transferred_to, transfer_reason, reviewer_notes } = req.body;

        const result = await pool.query(
            `
      UPDATE patient_intakes
      SET
        transferred_to = $1,
        transfer_reason = $2,
        transferred_at = CURRENT_TIMESTAMP,
        reviewer_notes = COALESCE($3, reviewer_notes),
        status = 'transferred',
        next_action = 'Awaiting Provider Review'
      WHERE id = $4
      RETURNING *
      `,
            [transferred_to, transfer_reason, reviewer_notes, id]
        );

        res.json({ success: true, intake: result.rows[0] });
    } catch (err) {
        console.error("Transfer error:", err);
        res.status(500).json({ success: false, error: "Transfer failed" });
    }
});
app.put("/api/intakes/:id/reviewed", async (req, res) => {
    try {
        const { id } = req.params;
        const { reviewed_by } = req.body;

        const result = await pool.query(
            `
      UPDATE patient_intakes
      SET
        status = 'under_review',
        reviewed_by = $1,
        reviewed_at = CURRENT_TIMESTAMP,
        next_action = 'Contact Patient'
      WHERE id = $2
      RETURNING *
      `,
            [reviewed_by || "Reviewer", id]
        );

        res.json({ success: true, intake: result.rows[0] });
    } catch (err) {
        console.error("Reviewed update error:", err);
        res.status(500).json({ success: false, error: "Reviewed update failed" });
    }
});
app.put("/api/intakes/:id/delete", async (req, res) => {

    try {

        const { id } = req.params;

        const result = await pool.query(

            `

            UPDATE patient_intakes

            SET status = 'deleted'

            WHERE id = $1

            RETURNING *

            `,

            [id]

        );

        res.json({

            success: true,

            intake: result.rows[0]

        });

    } catch (err) {

        console.error("Delete error:", err);

        res.status(500).json({

            success: false,

            error: "Delete failed"

        });

    }

});

app.listen(3001, "0.0.0.0", () => {

    console.log("WannaTalk running at http://0.0.0.0:3001");

});
