const multer = require('multer');
const path = require('path');

// Set storage engine
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const codeArticle =
  req.body.GA_CODEARTICLE?.replace(/\s+/g, '') ||
  req.params.id?.replace(/\s+/g, '') ||
  'unknown';

    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${codeArticle}${ext}`);
  }
  
});

// File filter (optional: image only)
const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.jpg', '.jpeg', '.png'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, JPEG, PNG files are allowed.'), false);
  }
};



const upload = multer({
  storage,
  fileFilter
});

module.exports = upload;
