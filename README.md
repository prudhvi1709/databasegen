# PDF to CSV Data Extractor

A professional web application that extracts text from PDF files and images, converts them to structured CSV format, and provides SQLite database export capabilities using AI-powered processing.

## Features

- **Multi-Format Support** - Process PDF files and images (PNG, JPG, JPEG, WebP)
- **AI-Powered Extraction** - Uses Gemini 2.5 Flash for intelligent data structure recognition
- **Database Export** - Convert extracted data to SQLite database format
- **Live Preview** - View extracted data in formatted tables
- **Data Analysis Integration** - Direct links to DataChat and QueryBot for data exploration
- **One-Click Downloads** - Export CSV and SQLite database files
- **Modern Interface** - Responsive Bootstrap-based design
- **Client-Side Processing** - No server required, runs entirely in the browser
- **Real-Time Feedback** - Visual progress indicators during processing

## Technology Stack

- **Frontend**: HTML5, JavaScript (ES6+), Bootstrap 5
- **PDF Processing**: Pyodide + PyPDF2
- **Image Processing**: AI vision for text extraction from images
- **Database**: SQLite generation via pandas
- **AI Integration**: Google Gemini 2.5 Flash API
- **Runtime**: Browser-based Python execution via Pyodide

## Quick Start

1. **Setup**
   ```bash
   git clone <repository-url>
   cd <repository-name>
   ```

2. **Run Application**
   ```bash
   # Open index.html in a modern web browser
   open index.html
   # OR serve locally
   python -m http.server 8000
   ```

3. **Usage**
   - Upload PDF files or images
   - Click "Process Files"
   - Preview extracted data
   - Download CSV or convert to SQLite database
   - Use DataChat or QueryBot for data analysis

## Project Structure

```
project/
├── index.html     # Main application interface
├── script.js      # Core application logic and utilities
├── README.md      # Documentation
├── LICENSE        # MIT License
```

## How It Works

1. **File Upload**: Support for PDFs and image files
2. **Text Extraction**: 
   - PDFs: PyPDF2 extracts text content
   - Images: AI vision analyzes and extracts tabular data
3. **Data Processing**: Gemini AI structures raw text into CSV format
4. **Database Conversion**: Pandas converts CSV to SQLite database
5. **Export Options**: Download CSV files or SQLite databases
6. **Analysis Integration**: Connect with external tools for data exploration

## Data Analysis Options

After extracting your data, you can analyze it using:

### For Small to Medium Files
- **DataChat**: Upload CSV/DB files to [datachat.straivedemo.com](https://datachat.straivedemo.com)
- Interactive web-based data analysis platform

### For Large Files
- **QueryBot**: Local data analysis tool
- Installation: `pip install querybot`
- Documentation: [pypi.org/project/querybot](https://pypi.org/project/querybot/)

## Configuration

The application uses the Gemini API for intelligent data extraction. The endpoint is configured in `app.js`:

```javascript
const LLM_BASE_URL = "https://llmfoundry.straive.com/gemini/v1beta/models/gemini-2.5-flash:generateContent";
```

## AI Processing Strategy

The system employs sophisticated prompts for optimal data extraction:

- Identifies structured data patterns (tables, lists, key-value pairs)
- Creates meaningful column headers
- Handles missing values appropriately
- Preserves data types and numerical accuracy
- Combines multiple data sources intelligently

## Browser Compatibility

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Privacy and Security

- **Local Processing**: File content processed in browser
- **Secure Communication**: HTTPS for all API calls
- **No File Storage**: Files not retained on servers
- **Minimal Data Transfer**: Only processed text sent to AI service

## Development

```bash
# Optional: Install development tools
npm install -g live-server prettier

# Start development server
python -m http.server

# Format code
prettier --write "**/*.js"
```

## Troubleshooting

**Pyodide Issues**:
- Ensure stable internet connection
- Refresh page if loading fails
- Check browser console for errors

**Processing Errors**:
- Verify PDF is not password-protected
- Ensure images contain clear, readable text/tables
- Try smaller files for testing

**Database Conversion**:
- Requires successful Pyodide initialization
- Check browser support for WebAssembly

## Contributing

1. Fork the repository
2. Create a feature branch
3. Implement changes with tests
4. Submit a pull request

## License

This project is licensed under the [MIT License](LICENSE).
