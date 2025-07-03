// All functionality consolidated into main app

// =============================================================================
// CONFIGURATION
// =============================================================================
const LLM_BASE_URL = "https://llmfoundry.straive.com/gemini/v1beta/models/gemini-2.5-flash:generateContent";

// =============================================================================
// GLOBAL STATE
// =============================================================================
let pyodide = null;
let currentCSVData = null;
let currentDbBlob = null;

// =============================================================================
// PYODIDE UTILITIES
// =============================================================================
async function initPyodide() {
  const pyodide = await window.loadPyodide();

  try {
    const code = `
import micropip
await micropip.install(["PyPDF2", "pandas", "sqlite3"])
`;
    await pyodide.loadPackagesFromImports(code);
    await pyodide.runPythonAsync(code);
  } catch (error) {
    console.warn("Could not install packages:", error);
  }

  return pyodide;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// =============================================================================
// TEXT EXTRACTION
// =============================================================================
async function extractText(file, pyodide) {
  const fileType = file.type;

  if (fileType === "application/pdf") {
    if (pyodide) {
      try {
        const base64Data = await fileToBase64(file);
        return await extractPDFText(base64Data, pyodide);
      } catch (error) {
        console.warn("Pyodide PDF extraction failed, using fallback:", error);
      }
    }
    return extractPDFTextFallback(file);
  } else if (fileType.startsWith("image/")) {
    const base64Data = await fileToBase64(file);
    return await extractImageToPandas(base64Data);
  } else {
    throw new Error(`Unsupported file type: ${fileType}`);
  }
}

async function extractPDFText(base64Data, pyodide) {
  const pythonCode = `
import io
import base64
from PyPDF2 import PdfReader

pdf_data = base64.b64decode(data)
pdf_file = io.BytesIO(pdf_data)

reader = PdfReader(pdf_file)
text = ""
for page in reader.pages:
    text += page.extract_text() + "\\n"

result = text.strip()
  `;

  try {
    await pyodide.loadPackagesFromImports(pythonCode);
    const dict = pyodide.globals.get("dict");
    const globals = dict();
    globals.set("data", base64Data);
    await pyodide.runPythonAsync(pythonCode, { globals });
    return globals.get("result");
  } catch (error) {
    throw new Error(`PDF extraction failed: ${error.message}`);
  }
}

async function extractPDFTextFallback(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function() {
      try {
        const pdfData = new Uint8Array(reader.result);
        const decoder = new TextDecoder();
        const pdfString = decoder.decode(pdfData, { fatal: false });
        
        const textMatches = pdfString.match(/\((.*?)\)/g);
        let text = "";
        if (textMatches) {
          text = textMatches
            .map(match => match.slice(1, -1))
            .filter(str => str.length > 1 && /[a-zA-Z0-9]/.test(str))
            .join(" ");
        }
        
        if (text.trim().length === 0) {
          text = "No readable text found. This PDF might be image-based or encrypted. Consider using a PDF with selectable text.";
        }
        
        resolve(text);
      } catch (error) {
        reject(new Error("Failed to extract text from PDF: " + error.message));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read PDF file"));
    reader.readAsArrayBuffer(file);
  });
}

async function extractImageToPandas(base64Data) {
  const systemPrompt = `Extract table data from this image and return as pandas code.

Return ONLY this format:
import pandas as pd
data = [{"col1": "val1", "col2": 123}, {"col1": "val2", "col2": 456}]
df = pd.DataFrame(data)
result = df.to_csv(index=False)

Use short column names. Include ALL rows visible. No explanations.`;
  
  const payload = {
    contents: [
      {
        parts: [
          {
            text: systemPrompt,
          },
          {
            inline_data: {
              mime_type: "image/jpeg",
              data: base64Data
            }
          }
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
    },
  };

  const response = await fetch(LLM_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Image text extraction failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (!result.candidates || result.candidates.length === 0) {
    throw new Error("No text found in image");
  }

  const candidate = result.candidates[0];
  
  // Handle different response structures
  let text = "";
  if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
    text = candidate.content.parts[0].text;
  } else if (candidate.text) {
    text = candidate.text;
  } else if (typeof candidate === 'string') {
    text = candidate;
  } else {
    throw new Error("Invalid response format from image extraction: " + JSON.stringify(candidate));
  }

  // Return the pandas code directly, will be executed by pyodide
  return text.trim();
}

// =============================================================================
// LLM SERVICE
// =============================================================================
async function convertToCSV(text) {
  // Single call: LLM extracts and formats as pandas code
  if (pyodide) {
    try {
      const pandasCode = await extractToPandasCode(text);
      return await executePandasCode(pandasCode);
    } catch (error) {
      console.warn("Pandas processing failed, using fallback:", error);
    }
  }
  
  // Simple fallback: direct LLM CSV generation
  return await getLLMGeneratedCSV(text);
}

async function extractToPandasCode(text) {
  const systemPrompt = `You are a data extraction expert. Analyze the provided text and extract all structured data, then create a complete pandas DataFrame solution.

Return complete Python code that:
1. Extracts all structured data from the text
2. Creates a pandas DataFrame 
3. Converts to CSV format

Format your response as complete Python code like this:
import pandas as pd

# Extract and structure the data
data = [
    {"column1": "value1", "column2": "value2", "column3": 123},
    {"column1": "value3", "column2": "value4", "column3": 456}
]

# Create DataFrame and convert to CSV
df = pd.DataFrame(data)
result = df.to_csv(index=False)

Instructions:
- Identify ALL structured data (tables, lists, key-value pairs, etc.)
- Create meaningful column names (use underscores, no spaces)
- Preserve data types (strings, numbers, dates, booleans)
- Handle missing values as None or empty strings
- If multiple tables exist, combine them logically or create the most important one
- Clean and normalize the data
- Return ONLY the Python code, no explanations

Text to analyze:`;

  const response = await callLLM(systemPrompt, text);
  return response.trim();
}

async function executePandasCode(pythonCode) {
  try {
    // Clean the code - remove markdown code blocks if present
    let cleanCode = pythonCode.trim();
    if (cleanCode.startsWith('```python')) {
      cleanCode = cleanCode.replace(/^```python\s*/, '').replace(/```\s*$/, '');
    } else if (cleanCode.startsWith('```')) {
      cleanCode = cleanCode.replace(/^```\s*/, '').replace(/```\s*$/, '');
    }
    cleanCode = cleanCode.trim();
    
    // Check if code looks incomplete (truncated)
    if (!cleanCode.includes('result =') && !cleanCode.includes('df.to_csv')) {
      throw new Error("Generated code appears incomplete - likely due to token limits");
    }
    await pyodide.loadPackagesFromImports(cleanCode);
    const dict = pyodide.globals.get("dict");
    const globals = dict();
    await pyodide.runPythonAsync(cleanCode, { globals });
    return globals.get("result");
  } catch (error) {
    throw new Error(`Pandas code execution failed: ${error.message}`);
  }
}

async function getLLMGeneratedCSV(text) {
  const systemPrompt = `You are a data extraction expert. Convert the provided text into a well-structured CSV format.

Instructions:
- Analyze the text to identify structured data (numbers, tables, lists, etc.)
- Create appropriate column headers based on the data structure
- Ensure each row represents a logical data entry
- Handle missing values with empty cells
- Preserve numerical accuracy
- If the text contains multiple tables or data types, combine them logically
- Return only the CSV content, no explanations

Text to convert:`;

  const response = await callLLM(systemPrompt, text);
  return response.trim();
}

async function callLLM(systemPrompt, userContent) {
  const payload = {
    contents: [
      {
        parts: [
          {
            text: `${systemPrompt}\n\n${userContent}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
    },
  };

  try {
    const response = await fetch(LLM_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("LLM API error response:", errorText);
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    if (!result.candidates || result.candidates.length === 0) {
      throw new Error("No response from LLM");
    }

    const candidate = result.candidates[0];
    
    // Handle different response structures
    if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
      return candidate.content.parts[0].text;
    } else if (candidate.text) {
      return candidate.text;
    } else if (typeof candidate === 'string') {
      return candidate;
    } else {
      throw new Error("Invalid response format from LLM: " + JSON.stringify(candidate));
    }
  } catch (error) {
    console.error("LLM call failed:", error);
    throw error;
  }
}

// =============================================================================
// DATABASE UTILITIES
// =============================================================================
async function convertCSVToDatabase(csvData) {
  if (!pyodide) {
    throw new Error("Database conversion requires Pyodide. Please reload the page.");
  }

  const pythonCode = `
import pandas as pd
import sqlite3
import io
import tempfile
import os

# Parse CSV data
csv_io = io.StringIO(csv_data)
df = pd.read_csv(csv_io)

# Create temporary file for SQLite database
temp_fd, temp_path = tempfile.mkstemp(suffix='.db')
os.close(temp_fd)

try:
    # Create SQLite database file
    conn = sqlite3.connect(temp_path)
    
    # Write DataFrame to SQLite
    table_name = 'extracted_data'
    df.to_sql(table_name, conn, index=False, if_exists='replace')
    conn.close()
    
    # Read the binary database file
    with open(temp_path, 'rb') as f:
        db_bytes = f.read()
    
    # Convert to JavaScript compatible format
    result = bytearray(db_bytes)
    
finally:
    # Clean up temporary file
    if os.path.exists(temp_path):
        os.unlink(temp_path)
`;

  try {
    await pyodide.loadPackagesFromImports(pythonCode);
    const dict = pyodide.globals.get("dict");
    const globals = dict();
    globals.set("csv_data", csvData);
    await pyodide.runPythonAsync(pythonCode, { globals });
    
    const byteArray = globals.get("result");
    return new Uint8Array(byteArray);
  } catch (error) {
    throw new Error(`Database conversion failed: ${error.message}`);
  }
}

function downloadDatabase(dbData) {
  if (!dbData) return;

  const blob = new Blob([dbData], { type: "application/x-sqlite3" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.setAttribute("href", url);
  link.setAttribute("download", `extracted-data-${new Date().toISOString().split("T")[0]}.db`);
  link.style.visibility = "hidden";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

// =============================================================================
// CSV UTILITIES
// =============================================================================
function renderCSV(csvData, container) {
  try {
    const lines = csvData.split("\n").filter((line) => line.trim());
    if (lines.length === 0) {
      container.innerHTML = '<p class="text-muted">No data to display</p>';
      return;
    }

    const table = document.createElement("table");
    table.className = "table table-striped table-hover table-sm";

    const rows = lines.map((line) => parseCSVLine(line));
    if (rows.length === 0 || !rows[0]) {
      container.innerHTML = '<p class="text-muted">Invalid CSV data format</p>';
      return;
    }
    const headers = rows[0];

  // Create header
  const thead = document.createElement("thead");
  thead.className = "table-dark";
  const headerRow = document.createElement("tr");
  headers.forEach((header) => {
    const th = document.createElement("th");
    th.textContent = header;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Create body
  const tbody = document.createElement("tbody");
  for (let i = 1; i < rows.length; i++) {
    const row = document.createElement("tr");
    rows[i].forEach((cell) => {
      const td = document.createElement("td");
      td.textContent = cell;
      if (isNumeric(cell)) {
        td.className = "text-end fw-bold";
      }
      row.appendChild(td);
    });
    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  container.replaceChildren(table);

  const summary = document.createElement("div");
  summary.className = "mt-2 text-muted small";
  summary.textContent = `${rows.length - 1} rows, ${headers.length} columns`;
  container.appendChild(summary);
  } catch (error) {
    console.error("CSV rendering error:", error);
    container.innerHTML = '<p class="text-danger">Error rendering CSV data</p>';
  }
}

function downloadCSV(csvData) {
  if (!csvData) return;

  const blob = new Blob([csvData], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.setAttribute("href", url);
  link.setAttribute("download", `extracted-data-${new Date().toISOString().split("T")[0]}.csv`);
  link.style.visibility = "hidden";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function isNumeric(str) {
  if (typeof str !== "string" || str.trim() === "") return false;
  return !isNaN(str) && !isNaN(parseFloat(str));
}

// =============================================================================
// DOM ELEMENTS
// =============================================================================
const fileInput = document.getElementById("file-input");
const processBtn = document.getElementById("process-btn");
const progressSection = document.getElementById("progress-section");
const progressText = document.getElementById("progress-text");
const errorSection = document.getElementById("error-section");
const errorMessage = document.getElementById("error-message");
const resultsSection = document.getElementById("results-section");
const csvContainer = document.getElementById("csv-container");
const downloadBtn = document.getElementById("download-btn");
const convertDbBtn = document.getElementById("convert-db-btn");

// Initialize app
async function init() {
  try {
    progressSection.style.display = "block";
    progressText.textContent = "Loading Pyodide...";
    pyodide = await initPyodide();
    progressSection.style.display = "none";
    
    if (!pyodide) {
      showWarning("Pyodide failed to load. Using basic PDF extraction mode.");
    }
  } catch (error) {
    console.warn("Pyodide initialization failed:", error);
    pyodide = null;
    progressSection.style.display = "none";
    showWarning("Advanced PDF processing unavailable. Using basic extraction mode.");
  }
}

// Event listeners
fileInput.addEventListener("change", () => {
  processBtn.disabled = fileInput.files.length === 0;
});

processBtn.addEventListener("click", processFiles);
downloadBtn.addEventListener("click", () => downloadCSV(currentCSVData));
convertDbBtn.addEventListener("click", convertToDatabase);

// Convert CSV to database
async function convertToDatabase() {
  if (!currentCSVData) {
    showError("No CSV data available to convert.");
    return;
  }

  if (!pyodide) {
    showError("Database conversion requires Pyodide. Please reload the page and try again.");
    return;
  }

  hideError();
  showProgress("Converting CSV to SQLite database...");

  try {
    const dbData = await convertCSVToDatabase(currentCSVData);
    currentDbBlob = dbData;
    
    hideProgress();
    downloadDatabase(dbData);
    
    showWarning("Database file downloaded successfully! The SQLite database contains a table named 'extracted_data' with your CSV data.");
  } catch (error) {
    hideProgress();
    console.error("Database conversion error:", error);
    showError("Database conversion failed: " + error.message);
  }
}

// Process uploaded files
async function processFiles() {
  const files = Array.from(fileInput.files);
  if (files.length === 0) return;

  hideError();
  showProgress("Processing files...");
  resultsSection.style.display = "none";

  try {
    let allText = "";

    let csvData = "";
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      progressText.textContent = `Processing ${file.name} (${i + 1}/${files.length})...`;

      if (file.type.startsWith("image/")) {
        // For images, we get pandas code directly
        const pandasCode = await extractText(file, pyodide);
        const singleCSV = await executePandasCode(pandasCode);
        csvData += (csvData ? "\n\n" : "") + singleCSV;
      } else {
        // For PDFs, we collect text first
        const text = await extractText(file, pyodide);
        allText += `\n\n--- ${file.name} ---\n${text}`;
      }
    }

    // Process collected PDF text if any
    if (allText.trim()) {
      progressText.textContent = "Converting PDF text to CSV...";
      const pdfCSV = await convertToCSV(allText.trim());
      csvData += (csvData ? "\n\n" : "") + pdfCSV;
    }

    if (!csvData || csvData.trim().length === 0) {
      throw new Error("No CSV data generated from the extracted text");
    }

    currentCSVData = csvData;
    renderCSV(csvData, csvContainer);

    hideProgress();
    resultsSection.style.display = "block";
  } catch (error) {
    hideProgress();
    console.error("Processing error:", error);
    showError("Processing failed: " + error.message + "\n\nCheck browser console for details.");
  }
}

// Chat functionality disabled for now

// UI utilities
function showProgress(text) {
  progressText.textContent = text;
  progressSection.style.display = "block";
}

function hideProgress() {
  progressSection.style.display = "none";
}

function showError(message) {
  errorMessage.textContent = message;
  errorSection.style.display = "block";
}

function hideError() {
  errorSection.style.display = "none";
}

function showWarning(message) {
  const warningDiv = document.createElement("div");
  warningDiv.className = "alert alert-warning alert-dismissible fade show";
  warningDiv.innerHTML = `
    <i class="bi bi-exclamation-triangle"></i> ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
  `;
  
  // Insert after progress section
  progressSection.parentNode.insertBefore(warningDiv, progressSection.nextSibling);
  
  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    if (warningDiv.parentNode) {
      warningDiv.remove();
    }
  }, 5000);
}

// Initialize when page loads
init(); 