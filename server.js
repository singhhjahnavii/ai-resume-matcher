// server.js - Free AI Resume Matcher using Hugging Face
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('path'); // Add this

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Add path.join

// Serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html')); // Use path.join
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

// Common words to ignore (stopwords)
const stopWords = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'will', 'have', 'has',
  'are', 'was', 'were', 'been', 'being', 'but', 'not', 'can', 'could', 'should',
  'would', 'may', 'might', 'must', 'shall', 'our', 'your', 'their', 'its',
  'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
  'when', 'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'only', 'own', 'same', 'than', 'too', 'very',
  'work', 'working', 'experience', 'years', 'team', 'company', 'role', 'position',
  'responsibilities', 'requirements', 'skills', 'ability', 'strong', 'good',
  'excellent', 'knowledge', 'understanding', 'including', 'required', 'preferred'
]);

// Technical skills and keywords database
const technicalTerms = new Set([
  // Programming Languages
  'javascript', 'python', 'java', 'typescript', 'c++', 'ruby', 'php', 'swift',
  'kotlin', 'go', 'rust', 'scala', 'r', 'matlab', 'perl', 'shell', 'bash',
  
  // Frontend
  'react', 'angular', 'vue', 'svelte', 'html', 'css', 'sass', 'less', 'webpack',
  'nextjs', 'gatsby', 'tailwind', 'bootstrap', 'jquery', 'redux', 'mobx',
  
  // Backend
  'nodejs', 'node.js', 'express', 'django', 'flask', 'spring', 'laravel',
  'rails', 'fastapi', 'nestjs', 'graphql', 'rest', 'api', 'microservices',
  
  // Databases
  'sql', 'mysql', 'postgresql', 'mongodb', 'redis', 'elasticsearch', 'cassandra',
  'dynamodb', 'oracle', 'sqlite', 'mariadb', 'nosql', 'firebase',
  
  // Cloud & DevOps
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'jenkins', 'gitlab', 'github',
  'terraform', 'ansible', 'ci/cd', 'devops', 'cloud', 'serverless', 'lambda',
  
  // Data Science & ML
  'tensorflow', 'pytorch', 'keras', 'scikit-learn', 'pandas', 'numpy', 'jupyter',
  'machine learning', 'deep learning', 'nlp', 'computer vision', 'data science',
  
  // Tools & Practices
  'git', 'jira', 'agile', 'scrum', 'kanban', 'testing', 'junit', 'jest',
  'cypress', 'selenium', 'tdd', 'bdd', 'linux', 'unix', 'nginx', 'apache',
  
  // Soft Skills
  'leadership', 'communication', 'collaboration', 'problem-solving', 'analytical',
  'mentoring', 'project management', 'stakeholder management'
]);

// Smart keyword extraction
function extractKeywords(text) {
  const normalizedText = text.toLowerCase()
    .replace(/[^\w\s.-]/g, ' ')
    .replace(/\s+/g, ' ');
  
  // Extract potential multi-word terms (like "machine learning", "project management")
  const multiWordTerms = [];
  technicalTerms.forEach(term => {
    if (term.includes(' ') && normalizedText.includes(term)) {
      multiWordTerms.push(term);
    }
  });
  
  // Extract single words
  const words = normalizedText.split(/\s+/)
    .filter(word => {
      // Keep if:
      // 1. Length > 2
      // 2. Not a stopword
      // 3. Either a technical term OR contains numbers/special chars (like "c++", "node.js")
      return word.length > 2 && 
             !stopWords.has(word) && 
             (technicalTerms.has(word) || /[\d+#.-]/.test(word));
    });
  
  // Combine single words and multi-word terms
  const allTerms = [...new Set([...multiWordTerms, ...words])];
  
  // Count occurrences
  const termCount = {};
  allTerms.forEach(term => {
    const count = (normalizedText.match(new RegExp(term, 'gi')) || []).length;
    termCount[term] = count;
  });
  
  // Sort by relevance (technical terms first, then by frequency)
  return Object.entries(termCount)
    .sort((a, b) => {
      const aIsTech = technicalTerms.has(a[0]);
      const bIsTech = technicalTerms.has(b[0]);
      
      if (aIsTech && !bIsTech) return -1;
      if (!aIsTech && bIsTech) return 1;
      return b[1] - a[1]; // Sort by frequency
    })
    .slice(0, 30)
    .map(([term]) => term);
}

// Analyze using Hugging Face Inference API (FREE)
async function analyzeWithHuggingFace(resumeText, jobDescription) {
  try {
    // Extract keywords from both texts
    const resumeKeywords = extractKeywords(resumeText);
    const jdKeywords = extractKeywords(jobDescription);
    
    // Find matched skills (case-insensitive matching)
    const matchedSkills = [];
    const resumeSet = new Set(resumeKeywords.map(k => k.toLowerCase()));
    
    jdKeywords.forEach(jdKeyword => {
      const jdLower = jdKeyword.toLowerCase();
      if (resumeSet.has(jdLower)) {
        matchedSkills.push(jdKeyword);
      }
    });
    
    // Find missing keywords (important ones from JD not in resume)
    const missingKeywords = jdKeywords
      .filter(jdKeyword => {
        const jdLower = jdKeyword.toLowerCase();
        return !resumeSet.has(jdLower) && technicalTerms.has(jdLower);
      })
      .slice(0, 6);
    
    // Calculate match score based on matched technical skills
    const technicalMatches = matchedSkills.filter(skill => 
      technicalTerms.has(skill.toLowerCase())
    );
    
    const technicalRequirements = jdKeywords.filter(keyword => 
      technicalTerms.has(keyword.toLowerCase())
    );
    
    let matchScore = 0;
    if (technicalRequirements.length > 0) {
      matchScore = Math.round(
        (technicalMatches.length / technicalRequirements.length) * 100
      );
    } else {
      // Fallback if no technical terms found
      matchScore = Math.round(
        (matchedSkills.length / Math.max(jdKeywords.length, 1)) * 85
      );
    }
    
    // Cap at 95% (never show 100%)
    matchScore = Math.min(matchScore, 95);
    
    // Ensure we have at least some matched skills to show
    const displaySkills = matchedSkills.length > 0 
      ? matchedSkills.slice(0, 8) 
      : resumeKeywords.filter(k => technicalTerms.has(k.toLowerCase())).slice(0, 5);
    
    // Use Hugging Face API for text generation (suggestions)
    const HF_API_URL = 'https://api-inference.huggingface.co/models/facebook/bart-large-cnn';
    
    const prompt = `Resume analysis for job application:\n\nJob Requirements: ${jobDescription.substring(0, 200)}\n\nResume Summary: ${resumeText.substring(0, 200)}\n\nProvide 3 brief improvement suggestions for the resume:`;
    
    let improvements = [
      "Add quantifiable metrics to your achievements (e.g., 'Increased performance by 40%', 'Led team of 5 developers')",
      "Include more technical keywords from the job description in your skills and experience sections",
      "Highlight projects or experiences that directly relate to the key responsibilities mentioned in the job description"
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
    const titlePatterns = [
      /(?:position|role|title|job):\s*([^\n,.]+)/i,
      /(?:hiring|seeking|looking for)\s+(?:a|an)?\s*([^\n,.]{10,50})/i,
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\s*$/m
    ];
    
    let positionTitle = "Target Position";
    for (const pattern of titlePatterns) {
      const match = jobDescription.match(pattern);
      if (match && match[1]) {
        positionTitle = match[1].trim();
        break;
      }
    }
    
    // Extract company name
    const companyPatterns = [
      /(?:company|at|employer):\s*([^\n,.]+)/i,
      /(?:join|work at|careers at)\s+([^\n,.]{2,30})/i
    ];
    
    let company = "Target Company";
    for (const pattern of companyPatterns) {
      const match = jobDescription.match(pattern);
      if (match && match[1]) {
        company = match[1].trim();
        break;
      }
    }
    
    const matchLevel = matchScore >= 80 ? "Strong Candidate Match" :
                       matchScore >= 60 ? "Good Candidate Match" :
                       matchScore >= 40 ? "Moderate Candidate Match" : "Potential Candidate Match";
    
    return {
      matchScore,
      matchLevel,
      positionTitle,
      company,
      missingKeywords: missingKeywords.slice(0, 5),
      skillsFound: displaySkills,
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