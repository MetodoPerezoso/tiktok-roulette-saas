const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../config.json');

// Cargar configuraciones al iniciar
function loadConfigs() {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error leyendo config.json:', error);
  }
  return {}; // Objeto vacío si no existe
}

// Guardar configuraciones
function saveConfigs(configs) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(configs, null, 2), 'utf8');
  } catch (error) {
    console.error('Error escribiendo config.json:', error);
  }
}

module.exports = { loadConfigs, saveConfigs };