// Pantalla de carga (index.html): le pone el logo y el color de la empresa recordada en este navegador, y el fondo
// oscuro si la cuenta lo usa así. Va en un archivo aparte porque la política de contenido no deja scripts dentro de la
// página. Sin empresa recordada (o si algo falla) queda el logo de Delisy.
(function () {
  try {
    var pantalla = document.getElementById('arranque')
    if (!pantalla) return
    var tema = localStorage.getItem('tema-panel')
    var ruta = location.pathname + location.hash
    // El tema es de la cuenta y vale en el panel y en la app de reparto (copia en este navegador, src/lib/tema.ts).
    var oscuro = tema === 'oscuro' || (!tema && matchMedia('(prefers-color-scheme: dark)').matches)
    if (oscuro) pantalla.classList.add('oscuro')
    else {
      var fondo = (JSON.parse(localStorage.getItem('preferencias-panel') || '{}') || {}).fondo
      if (fondo === 'blanco') pantalla.style.background = '#ffffff'
      else if (fondo === 'gris') pantalla.style.background = '#f1f2f0'
    }
    if (/\/plataforma/.test(ruta)) return // el panel de la plataforma es de Delisy
    var marca = JSON.parse(localStorage.getItem('marca-empresa') || 'null')
    if (!marca || !marca.nombre) return
    var cargador = pantalla.querySelector('.cargador')
    var logo = pantalla.querySelector('.cargador-logo')
    if (/^#[0-9a-f]{6}$/i.test(marca.color || '')) cargador.style.setProperty('--carga-color', marca.color)
    else cargador.style.setProperty('--carga-color', '#035d38')
    if (typeof marca.logo === 'string' && /^data:image\//.test(marca.logo)) logo.querySelector('img').src = marca.logo
    else { logo.textContent = marca.nombre.trim().charAt(0).toUpperCase(); logo.classList.add('inicial') }
  } catch (e) { /* sin almacenamiento: queda Delisy */ }
})()
