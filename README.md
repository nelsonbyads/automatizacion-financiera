# 💳 Meta Finance Hub — Auditoría de Facturación

Un sistema integral diseñado para automatizar y visualizar la auditoría de cobros de cuentas publicitarias asociadas a un **Administrador Comercial (Business Manager) de Meta**. 

Este proyecto consta de dos partes principales:
1. **Extractor de API (Node.js)**: Un script de consola (`script.js`) que consulta la Graph API de Meta para consolidar transacciones y cambios de métodos de pago en un mes específico.
2. **Dashboard de Visualización (Vite + React)**: Una interfaz moderna y premium de tipo Single Page Application (SPA) para analizar interactivamente los cobros diarios, filtrar información y realizar auditorías visuales ágiles.

---

## 📂 Estructura del Proyecto

```bash
PROYECTO FINANCIERA/
├── src/
│   ├── App.jsx            # Interfaz principal en React (Auditoría, importador, filtros y métricas)
│   ├── index.css          # Sistema de diseño y estilos CSS (Glassmorphism, Dark Theme, animaciones)
│   └── main.jsx           # Punto de entrada de React
├── index.html             # HTML base con fuentes integradas (Outfit y Plus Jakarta Sans)
├── package.json           # Configuración de dependencias de Node.js y React
├── script.js              # Script extractor de facturación mediante Meta Graph API
├── report_2026-08.txt     # Reporte de ejemplo autogenerado para el mes de Agosto 2026
├── .env.example           # Plantilla de variables de entorno para el extractor de API
└── vite.config.js         # Configuración de empaquetado Vite para React
```

---

## 🌟 Características Clave

### 📡 Extractor de API (`script.js`)
- **Consulta Automatizada**: Obtiene de forma automática todas las cuentas publicitarias administradas por tu Business ID.
- **Paginación Inteligente**: Descarga de forma recursiva todas las transacciones (`ad_account_billing_charge`) y eventos de presupuesto (`BUDGET`) del mes indicado.
- **Detección de Cambios**: Identifica si se agregaron o eliminaron métodos de pago durante el mes analizado.
- **Generación de Reportes**: Exporta la información estructurada por día y cuenta publicitaria directamente a un archivo de texto plano (ej: `report_2026-08.txt`).

### 📊 Dashboard Interactivo (`App.jsx`)
- **Diseño Premium & Inmersivo**: Interfaz fluida con modo oscuro nativo, efectos de desenfoque de fondo (*glassmorphism*), transiciones micro-animadas y tipografía moderna.
- **Importador de Datos Dual**: Permite copiar y pegar directamente el reporte de texto generado por el script o importar la estructura de datos en formato JSON nativo.
- **Filtros Avanzados**:
  - Buscador predictivo por nombre de cuenta e ID de cuenta publicitaria.
  - Selector de moneda (COP, USD, o todas).
  - Filtro por cambio de método de pago (para detectar cuentas que modificaron su método de cobro en el mes).
  - Selector de fechas del mes para aislar días específicos de facturación.
- **Auditoría Detallada**: Desglose expandible (tipo acordeón) para cada cuenta que muestra el listado completo de transacciones individuales con sus ID únicos, fechas y horas locales precisas.
- **Anomalías Visuales**: Indicadores de advertencia si la cuenta no cuenta con información de método de pago disponible o si ha registrado cambios de tarjetas recientemente.

---

## 🛠️ Requisitos Previos

- **Node.js**: Versión 18.0 o superior (para soporte nativo de `fetch` en el extractor de API).
- **Meta Ads API**:
  - Un **Token de Acceso de Meta** con permisos de lectura para cuentas publicitarias y datos financieros (`ads_read` y `business_management` recomendados).
  - Un ID de **Administrador Comercial (Business Manager)**.

---

## 🚀 Guía de Instalación y Configuración

### 1. Clonar e Instalar Dependencias
Instala los paquetes necesarios para ejecutar la interfaz web:
```bash
npm install
```

### 2. Configurar Variables de Entorno
Crea un archivo `.env` en la raíz del proyecto basándote en la plantilla `.env.example`:
```bash
cp .env.example .env
```
Edita `.env` con tus credenciales:
```env
META_ACCESS_TOKEN=tu_token_de_acceso_aqui
BUSINESS_ID=tu_id_de_business_manager_aqui
REPORT_MONTH=2026-08
GRAPH_VERSION=v25.0
```

---

## 💻 Instrucciones de Uso

### Paso 1: Extraer Datos de Meta
Ejecuta el script Node.js para recuperar las facturas directamente desde los servidores de Meta. Esto generará un archivo de reporte y mostrará un resumen en consola.
```bash
node script.js
```
El archivo de salida se guardará en la raíz del proyecto como `report_YYYY-MM.txt` (por ejemplo, `report_2026-08.txt`).

### Paso 2: Levantar el Dashboard de React
Inicia el servidor de desarrollo local para el Dashboard interactivo:
```bash
npm run dev
```
Abre tu navegador en la URL local que muestre la consola (por lo general, `http://localhost:5173`).

### Paso 3: Importar y Auditar
1. Haz clic en el botón **"Importar Reporte"** en la barra superior del dashboard.
2. Abre el archivo de reporte generado (`report_2026-08.txt`) y copia todo su contenido.
3. Pega el texto en la caja de importación y pulsa **"Procesar Datos"**.
4. ¡Listo! El dashboard se actualizará dinámicamente con los cobros del mes, permitiéndote buscar, filtrar y expandir los detalles de cada cobro.

---

## 💻 Desarrollo y Compilación para Producción

Si deseas empaquetar la aplicación para desplegarla en un servidor web estático:
```bash
# Compilar proyecto
npm run build

# Vista previa local de la compilación
npm run preview
```

---

## 🔒 Seguridad y Buenas Prácticas
> [!WARNING]
> Nunca incluyas tu token de acceso (`META_ACCESS_TOKEN`) ni archivos `.env` en commits de repositorios públicos de Git. Asegúrate de añadir el archivo `.env` a tu `.gitignore`.
