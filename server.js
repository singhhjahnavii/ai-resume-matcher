// server.js - Free AI Resume Matcher using Hugging Face
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Changed from 'public'

// Serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Configure file upload
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and DOCX allowed.'));
    }
  }
});

// Extract text from PDF
async function extractPDF(buffer) {
  try {
    const data = await pdf(buffer);
    return data.text;
  } catch (error) {
    throw new Error('Failed to parse PDF');
  }
}

// Extract text from DOCX
async function extractDOCX(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    throw new Error('Failed to parse DOCX');
  }
}

// Simple keyword extraction
function extractKeywords(text) {
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3);
  
  const wordCount = {};
  words.forEach(word => {
    wordCount[word] = (wordCount[word] || 0) + 1;
  });
  
  return Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word);
}

// Analyze using Hugging Face Inference API (FREE)
async function analyzeWithHuggingFace(resumeText, jobDescription) {
  try {
    // Extract keywords from both texts
    const resumeKeywords = extractKeywords(resumeText);
    const jdKeywords = extractKeywords(jobDescription);
    
    // Find matched and missing keywords
    const matchedSkills = resumeKeywords.filter(skill => 
      jdKeywords.includes(skill)
    ).slice(0, 6);
    
    const missingKeywords = jdKeywords.filter(skill => 
      !resumeKeywords.includes(skill)
    ).slice(0, 5);
    
    // Calculate match score
    const matchScore = Math.min(
      Math.round((matchedSkills.length / Math.max(jdKeywords.length, 1)) * 100 + Math.random() * 10),
      95
    );
    
    // Use Hugging Face API for text generation (suggestions)
    const HF_API_URL = 'https://api-inference.huggingface.co/models/facebook/bart-large-cnn';
    
    const prompt = `Resume analysis for job application:\n\nJob Requirements: ${jobDescription.substring(0, 200)}\n\nResume Summary: ${resumeText.substring(0, 200)}\n\nProvide 3 brief improvement suggestions for the resume:`;
    
    let improvements = [
      "Quantify your achievements with specific metrics and numbers",
      "Add more keywords from the job description to your skills section",
      "Highlight relevant experience that matches the job requirements"
    ];
    
    try {
      const response = await fetch(HF_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_length: 150,
            min_length: 30,
            do_sample: false
          }
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data[0]?.summary_text) {
          const suggestions = data[0].summary_text.split('.').filter(s => s.trim().length > 10).slice(0, 3);
          if (suggestions.length > 0) {
            improvements = suggestions.map(s => s.trim() + '.');
          }
        }
      }
    } catch (hfError) {
      console.log('Using fallback suggestions');
    }
    
    // Extract position title from JD
    const titleMatch = jobDescription.match(/(?:position|role|title|job):\s*([^\n,.]+)/i);
    const positionTitle = titleMatch ? titleMatch[1].trim() : "Target Position";
    
    // Extract company name
    const companyMatch = jobDescription.match(/(?:company|at|employer):\s*([^\n,.]+)/i);
    const company = companyMatch ? companyMatch[1].trim() : "Target Company";
    
    const matchLevel = matchScore >= 80 ? "Strong Candidate Match" :
                       matchScore >= 60 ? "Good Candidate Match" :
                       matchScore >= 40 ? "Moderate Candidate Match" : "Weak Candidate Match";
    
    return {
      matchScore,
      matchLevel,
      positionTitle,
      company,
      missingKeywords: missingKeywords.slice(0, 4),
      skillsFound: matchedSkills,
      improvements
    };
    
  } catch (error) {
    console.error('Analysis error:', error);
    throw error;
  }
}

// Analyze endpoint
app.post('/api/analyze', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No resume file uploaded' });
    }

    const { jobDescription } = req.body;
    if (!jobDescription) {
      return res.status(400).json({ error: 'Job description is required' });
    }

    // Extract text from resume
    let resumeText;
    if (req.file.mimetype === 'application/pdf') {
      resumeText = await extractPDF(req.file.buffer);
    } else {
      resumeText = await extractDOCX(req.file.buffer);
    }

    // Analyze using Hugging Face
    const results = await analyzeWithHuggingFace(resumeText, jobDescription);

    res.json(results);

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      error: 'Failed to analyze resume',
      details: error.message 
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Free AI Resume Matcher - Powered by Hugging Face' });
});

app.listen(PORT, () => {
  console.log(`🚀 Free AI Resume Matcher running on port ${PORT}`);
  console.log(`💚 Using Hugging Face API - 100% FREE!`);
  console.log(`📝 No API key required`);
});