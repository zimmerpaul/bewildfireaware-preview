// Live weather + air quality strip. Client-side so it's always current
// (the site itself rebuilds only once daily). No API keys:
//   - forecast: National Weather Service (api.weather.gov)
//   - air quality: Open-Meteo US AQI (air-quality-api.open-meteo.com)
// Renders into any element with [data-wx][data-lat][data-lon], and is also
// callable as window.bwaWeather.render(el, lat, lon) (homepage locate card).
(function () {
  var AQI_CATS = [
    [50, 'Good', 'aqi-good'],
    [100, 'Moderate', 'aqi-moderate'],
    [150, 'Unhealthy for Sensitive Groups', 'aqi-usg'],
    [200, 'Unhealthy', 'aqi-unhealthy'],
    [300, 'Very Unhealthy', 'aqi-veryunhealthy'],
    [10000, 'Hazardous', 'aqi-hazardous'],
  ];

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function aqiCat(v) {
    for (var i = 0; i < AQI_CATS.length; i++) if (v <= AQI_CATS[i][0]) return AQI_CATS[i];
    return AQI_CATS[AQI_CATS.length - 1];
  }

  function render(el, lat, lon) {
    el.innerHTML = '<span class="wx-loading">Loading current weather &amp; air quality…</span>';

    var nws = fetch('https://api.weather.gov/points/' + lat + ',' + lon)
      .then(function (r) { return r.json(); })
      .then(function (p) { return fetch(p.properties.forecast); })
      .then(function (r) { return r.json(); })
      .then(function (f) { return f.properties.periods.slice(0, 3); });

    var aqi = fetch('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + lat +
        '&longitude=' + lon + '&current=us_aqi,pm2_5&timezone=America%2FDenver')
      .then(function (r) { return r.json(); })
      .then(function (a) { return a.current; });

    // Card + credit destinations: NWS point-forecast page for weather,
    // AirNow's Fire & Smoke map for air quality.
    var nwsUrl = 'https://forecast.weather.gov/MapClick.php?lat=' + lat + '&lon=' + lon;
    var airnowUrl = 'https://fire.airnow.gov/#9/' + lat + '/' + lon;

    Promise.allSettled([nws, aqi]).then(function (results) {
      var periods = results[0].status === 'fulfilled' ? results[0].value : null;
      var air = results[1].status === 'fulfilled' ? results[1].value : null;
      var html = '';

      if (periods) {
        periods.forEach(function (p) {
          html += '<a class="wx-chip" href="' + nwsUrl + '" target="_blank" rel="noopener" title="Full NWS forecast for this spot">' +
            '<span class="wx-name">' + esc(p.name) + ' <span class="wx-ext">↗</span></span>' +
            '<span class="wx-temp">' + esc(p.temperature) + '°' + esc(p.temperatureUnit) + '</span>' +
            '<span class="wx-desc">' + esc(p.shortForecast) + '</span>' +
            '<span class="wx-wind">Wind ' + esc(p.windDirection || '') + ' ' + esc(p.windSpeed || '') + '</span>' +
            '</a>';
        });
      }
      if (air && typeof air.us_aqi === 'number') {
        var cat = aqiCat(air.us_aqi);
        html += '<a class="wx-chip wx-aqi ' + cat[2] + '" href="' + airnowUrl + '" target="_blank" rel="noopener" title="AirNow Fire & Smoke map for this spot">' +
          '<span class="wx-name">Air Quality <span class="wx-ext">↗</span></span>' +
          '<span class="wx-temp">' + esc(air.us_aqi) + '</span>' +
          '<span class="wx-desc">' + cat[1] + '</span>' +
          (typeof air.pm2_5 === 'number' ? '<span class="wx-wind">PM2.5 ' + esc(air.pm2_5) + ' µg/m³</span>' : '') +
          '</a>';
      }

      el.innerHTML = html ||
        '<span class="wx-loading">Live weather is unavailable right now.</span>';
      if (html) {
        el.insertAdjacentHTML('afterend',
          el.nextElementSibling && el.nextElementSibling.classList.contains('wx-credit') ? '' :
          '<p class="wx-credit">Live: forecast from the <a href="' + nwsUrl + '" target="_blank" rel="noopener">National Weather Service</a> · ' +
          'air quality data via <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> · ' +
          'smoke map at <a href="' + airnowUrl + '" target="_blank" rel="noopener">AirNow</a></p>');
      }
    });
  }

  function init() {
    document.querySelectorAll('[data-wx]').forEach(function (el) {
      var lat = el.getAttribute('data-lat'), lon = el.getAttribute('data-lon');
      if (lat && lon) render(el, lat, lon);
    });
  }

  window.bwaWeather = { render: render };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
