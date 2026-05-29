// ── CONSTANTS ────────────────────────────────────────────────────────────────

const REGION_COLORS = {
  'Arctic':          '#ff4d6d',
  'N. Temperate':    '#f4a261',
  'Tropical':        '#90e0ef',
  'S. Temperate':    '#48cae4',
  'Southern Ocean':  '#0077b6',
};

const REGION_ORDER = ['Arctic', 'N. Temperate', 'Tropical', 'S. Temperate', 'Southern Ocean'];

function getBasin(lat) {
  if (lat > 60)  return 'Arctic';
  if (lat > 30)  return 'N. Temperate';
  if (lat > -30) return 'Tropical';
  if (lat > -60) return 'S. Temperate';
  return 'Southern Ocean';
}

const tooltip = document.getElementById('tooltip');

function showTooltip(event, html) {
  tooltip.innerHTML = html;
  tooltip.classList.add('show');
  moveTooltip(event);
}

function moveTooltip(event) {
  tooltip.style.left = (event.clientX + 16) + 'px';
  tooltip.style.top  = (event.clientY - 10) + 'px';
}

function hideTooltip() {
  tooltip.classList.remove('show');
}


// Shared interaction state. The regional line chart can call this after the map exists.
let updateMapRegionFocus = null;
let lastMapAlpha = 0.76;

function focusMapRegion(basin) {
  if (typeof updateMapRegionFocus === 'function') updateMapRegionFocus(basin);
}

// ── HERO CANVAS ───────────────────────────────────────────────────────────────

function initHeroCanvas() {
  const canvas = document.getElementById('hero-canvas');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  let t = 0;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const W = canvas.width, H = canvas.height;
    for (let i = 0; i < 6; i++) {
      const amp   = 18 + i * 10;
      const freq  = 0.007 - i * 0.0008;
      const speed = 0.35 + i * 0.12;
      const yBase = H * (0.25 + i * 0.11);
      const alpha = 0.07 - i * 0.009;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let px = 0; px <= W; px += 5) {
        ctx.lineTo(px, yBase + amp * Math.sin(px * freq + t * speed));
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fillStyle = `rgba(0,180,216,${alpha})`;
      ctx.fill();
    }
    t += 0.018;
    requestAnimationFrame(draw);
  }
  draw();

  window.addEventListener('resize', () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  });
}

initHeroCanvas();

// ── DATA LOAD ─────────────────────────────────────────────────────────────────

Promise.all([
  d3.csv('annual_mean_surface_ph_peryear_1850_2014.csv', d => ({
    year: +d.time.slice(0, 4),
    lat:  +d.lat_5deg,
    lon:  +d.lon_5deg,
    ph:   +d.ph,
  })),
  d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'),
]).then(([data, worldTopo]) => {

  // ── GLOBAL TREND ──────────────────────────────────────────────────────────
  const globalByYear = Array.from(
    d3.rollup(data, v => d3.mean(v, d => d.ph), d => d.year),
    ([year, ph]) => ({ year, ph })
  ).sort((a, b) => a.year - b.year);

  // ── REGIONAL TRENDS ───────────────────────────────────────────────────────
  const regionalMap = d3.rollup(
    data,
    v => d3.mean(v, d => d.ph),
    d => getBasin(d.lat),
    d => d.year
  );

  const regionalSeries = REGION_ORDER.map(basin => ({
    basin,
    values: Array.from(regionalMap.get(basin) || [], ([year, ph]) => ({ year, ph }))
              .sort((a, b) => a.year - b.year),
  }));

  // ── DELTA MAP DATA ────────────────────────────────────────────────────────
  const byCell = d3.group(data, d => `${d.lat},${d.lon}`);
  const deltaData = Array.from(byCell, ([key, rows]) => {
    const r1850 = rows.find(r => r.year === 1850);
    const r2014 = rows.find(r => r.year === 2014);
    if (!r1850 || !r2014) return null;
    const [lat, lon] = key.split(',').map(Number);
    return { lat, lon, delta: r2014.ph - r1850.ph, ph1850: r1850.ph, ph2014: r2014.ph };
  }).filter(Boolean);

  const explorerSeries = aggregateExplorerRegions(data);

  renderGlobalTrend(globalByYear);
  renderRegionalChart(regionalSeries);
  renderDeltaMap(deltaData, worldTopo, regionalMap);
  renderDepthExplorer(explorerSeries, data, worldTopo);
  setupObserver();
});

// ── VIZ 1: GLOBAL TREND ───────────────────────────────────────────────────────

function renderGlobalTrend(data) {
  const el    = document.getElementById('viz-trend');
  const W     = el.clientWidth || 560;
  const m     = { top: 24, right: 24, bottom: 44, left: 58 };
  const iW    = W - m.left - m.right;
  const iH    = 320 - m.top - m.bottom;

  const svg = d3.select('#viz-trend').append('svg')
    .attr('width', W).attr('height', iH + m.top + m.bottom)
    .attr('class', 'viz-svg')
    .append('g').attr('transform', `translate(${m.left},${m.top})`);

  const x = d3.scaleLinear().domain([1850, 2014]).range([0, iW]);
  const [yMin, yMax] = d3.extent(data, d => d.ph);
  const y = d3.scaleLinear().domain([yMin - 0.005, yMax + 0.008]).range([iH, 0]);

  // Grid
  svg.append('g').call(d3.axisLeft(y).tickSize(-iW).tickFormat(''))
    .selectAll('.tick line').attr('stroke', '#0e2a3d').attr('stroke-dasharray', '3,4');
  svg.select('.domain').remove();

  // Axes
  svg.append('g').attr('transform', `translate(0,${iH})`)
    .call(d3.axisBottom(x).tickFormat(d3.format('d')).ticks(8))
    .call(g => { g.select('.domain').attr('stroke','#0e2a3d'); g.selectAll('text').attr('fill','#7fb3c8'); });

  svg.append('g').call(d3.axisLeft(y).ticks(6).tickFormat(d3.format('.3f')))
    .call(g => { g.select('.domain').attr('stroke','#0e2a3d'); g.selectAll('text').attr('fill','#7fb3c8'); });

  svg.append('text').attr('transform','rotate(-90)').attr('x',-iH/2).attr('y',-m.left+14)
    .attr('text-anchor','middle').attr('fill','#7fb3c8').style('font-size','11px').text('Sea Surface pH');

  // 1850 baseline
  const baseline1850 = data[0].ph;
  svg.append('line')
    .attr('x1', 0).attr('x2', iW)
    .attr('y1', y(baseline1850)).attr('y2', y(baseline1850))
    .attr('stroke', '#f4a261').attr('stroke-width', 1.5).attr('stroke-dasharray', '6,4').attr('opacity', 0.8);
  svg.append('text')
    .attr('x', iW - 4).attr('y', y(baseline1850) - 7)
    .attr('text-anchor', 'end').attr('fill', '#f4a261').style('font-size', '11px')
    .text(`1850 baseline (${baseline1850.toFixed(3)})`);

  // Deficit shading
  const deficitShading = svg.append('path').datum(data)
    .attr('fill', '#ff4d6d').attr('opacity', 0.1)
    .attr('d', d3.area().x(d => x(d.year)).y0(y(baseline1850)).y1(d => y(d.ph)).curve(d3.curveCatmullRom));

  const toggleBtn = document.getElementById('btn-toggle-shading');
  let shadingVisible = true;
  toggleBtn.addEventListener('click', () => {
    shadingVisible = !shadingVisible;
    deficitShading.attr('opacity', shadingVisible ? 0.1 : 0);
    toggleBtn.textContent = shadingVisible ? 'Hide Acidification Deficit' : 'Show Acidification Deficit';
  });

  // Main line — animated
  const linePath = svg.append('path').datum(data)
    .attr('fill', 'none').attr('stroke', '#00b4d8').attr('stroke-width', 2.5)
    .attr('d', d3.line().x(d => x(d.year)).y(d => y(d.ph)).curve(d3.curveCatmullRom));

  const len = linePath.node().getTotalLength();
  linePath.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len);

  document.getElementById('section-trend')._animate = () => {
    linePath.transition().duration(2200).ease(d3.easeCubicInOut).attr('stroke-dashoffset', 0);
  };

  // Dots + tooltip (every 5 years to avoid clutter)
  const sparse = data.filter(d => d.year % 5 === 0);
  svg.selectAll('.dot').data(sparse).enter().append('circle')
    .attr('cx', d => x(d.year)).attr('cy', d => y(d.ph))
    .attr('r', 4).attr('fill', '#00b4d8').attr('stroke', '#020d1a').attr('stroke-width', 2)
    .on('mouseover', (event, d) => showTooltip(event,
      `<strong>${d.year}</strong><br>pH: ${d.ph.toFixed(4)}<br><span style="color:#ff4d6d">Δ from 1850: ${(d.ph - data[0].ph).toFixed(4)}</span>`))
    .on('mousemove', moveTooltip)
    .on('mouseout', hideTooltip);
}

// ── VIZ 2: REGIONAL DIVERGENCE ────────────────────────────────────────────────

function renderRegionalChart(series) {
  const el = document.getElementById('viz-regional');
  const W  = el.clientWidth || 560;
  const m  = { top: 24, right: 150, bottom: 44, left: 58 };
  const iW = W - m.left - m.right;
  const iH = 340 - m.top - m.bottom;

  const svg = d3.select('#viz-regional').append('svg')
    .attr('width', W).attr('height', iH + m.top + m.bottom)
    .attr('class', 'viz-svg')
    .append('g').attr('transform', `translate(${m.left},${m.top})`);

  const allVals = series.flatMap(s => s.values);
  const x = d3.scaleLinear().domain([1850, 2014]).range([0, iW]);
  const y = d3.scaleLinear()
    .domain([d3.min(allVals, d => d.ph) - 0.005, d3.max(allVals, d => d.ph) + 0.008])
    .range([iH, 0]);

  // Grid
  svg.append('g').call(d3.axisLeft(y).tickSize(-iW).tickFormat(''))
    .selectAll('.tick line').attr('stroke', '#0e2a3d').attr('stroke-dasharray', '3,4');
  svg.select('.domain').remove();

  // Axes
  svg.append('g').attr('transform', `translate(0,${iH})`)
    .call(d3.axisBottom(x).tickFormat(d3.format('d')).ticks(8))
    .call(g => { g.select('.domain').attr('stroke','#0e2a3d'); g.selectAll('text').attr('fill','#7fb3c8'); });
  svg.append('g').call(d3.axisLeft(y).ticks(6).tickFormat(d3.format('.3f')))
    .call(g => { g.select('.domain').attr('stroke','#0e2a3d'); g.selectAll('text').attr('fill','#7fb3c8'); });

  svg.append('text').attr('transform','rotate(-90)').attr('x',-iH/2).attr('y',-m.left+14)
    .attr('text-anchor','middle').attr('fill','#7fb3c8').style('font-size','11px').text('Sea Surface pH');

  svg.append('text')
    .attr('x', 0)
    .attr('y', -9)
    .attr('fill', '#7fb3c8')
    .attr('opacity', 0.85)
    .style('font-size', '10px')
    .text('Hover a region line or label to highlight the matching latitude band on the map.');

  const lineGen = d3.line().x(d => x(d.year)).y(d => y(d.ph)).curve(d3.curveCatmullRom);
  const labelX = iW + 16;
  const minLabelGap = 16;

  function spreadLabels(labels) {
    const sorted = labels.slice().sort((a, b) => a.y - b.y);
    sorted.forEach((d, i) => {
      d.labelY = i === 0 ? d.y : Math.max(d.y, sorted[i - 1].labelY + minLabelGap);
    });
    const overflow = sorted.length ? sorted[sorted.length - 1].labelY - (iH - 4) : 0;
    if (overflow > 0) sorted.forEach(d => d.labelY -= overflow);
    sorted.forEach((d, i) => {
      d.labelY = i === 0 ? Math.max(4, d.labelY) : Math.max(d.labelY, sorted[i - 1].labelY + minLabelGap);
    });
    return sorted;
  }

  function showRegionTooltip(event, d) {
    const first = d.values[0];
    const last = d.values[d.values.length - 1];
    showTooltip(event,
      `<strong>${d.basin}</strong><br>` +
      `1850 pH: ${first.ph.toFixed(4)}<br>` +
      `2014 pH: ${last.ph.toFixed(4)}<br>` +
      `<span style="color:#ff4d6d">Δ pH: ${(last.ph - first.ph).toFixed(4)}</span>`);
  }

  function focusRegionalChart(basin) {
    svg.selectAll('.regional-line')
      .attr('opacity', d => !basin || d.basin === basin ? 1 : 0.16)
      .attr('stroke-width', d => basin && d.basin === basin ? 3.3 : 2.2);

    svg.selectAll('.regional-label, .regional-label-line')
      .attr('opacity', d => !basin || d.basin === basin ? 1 : 0.18);
  }

  const labelData = [];

  // Draw lines (hidden, revealed on scroll)
  const paths = series.map(({ basin, values }) => {
    const path = svg.append('path')
      .datum({ basin, values })
      .attr('class', 'regional-line')
      .attr('fill', 'none')
      .attr('stroke', REGION_COLORS[basin])
      .attr('stroke-width', 2.2)
      .attr('opacity', 0.9)
      .attr('d', d => lineGen(d.values))
      .on('mouseover', (event, d) => {
        focusRegionalChart(d.basin);
        focusMapRegion(d.basin);
        showRegionTooltip(event, d);
      })
      .on('mousemove', (event, d) => showRegionTooltip(event, d))
      .on('mouseout', () => {
        focusRegionalChart(null);
        focusMapRegion(null);
        hideTooltip();
      });

    const len = path.node().getTotalLength();
    path.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len);

    const last = values[values.length - 1];
    labelData.push({ basin, values, x: x(last.year), y: y(last.ph), ph: last.ph });

    return path;
  });

  // End labels: spread vertically to avoid overlap, with connector lines back to each series.
  const placedLabels = spreadLabels(labelData);

  svg.selectAll('.regional-label-line')
    .data(placedLabels)
    .enter()
    .append('line')
    .attr('class', 'regional-label-line')
    .attr('x1', d => d.x + 3)
    .attr('x2', labelX - 5)
    .attr('y1', d => d.y)
    .attr('y2', d => d.labelY)
    .attr('stroke', d => REGION_COLORS[d.basin])
    .attr('stroke-width', 1)
    .attr('opacity', 0.45);

  svg.selectAll('.regional-label')
    .data(placedLabels)
    .enter()
    .append('text')
    .attr('class', 'regional-label')
    .attr('x', labelX)
    .attr('y', d => d.labelY + 4)
    .attr('fill', d => REGION_COLORS[d.basin])
    .style('font-size', '10px')
    .style('font-weight', '600')
    .style('cursor', 'default')
    .text(d => d.basin)
    .on('mouseover', (event, d) => {
      focusRegionalChart(d.basin);
      focusMapRegion(d.basin);
      showRegionTooltip(event, d);
    })
    .on('mousemove', (event, d) => showRegionTooltip(event, d))
    .on('mouseout', () => {
      focusRegionalChart(null);
      focusMapRegion(null);
      hideTooltip();
    });

  document.getElementById('section-regional')._animate = () => {
    paths.forEach((path, i) => {
      const len = +path.attr('stroke-dasharray').split(' ')[0];
      path.transition().delay(i * 180).duration(1800).ease(d3.easeCubicInOut)
        .attr('stroke-dashoffset', 0);
    });
  };
}

// ── VIZ 3: DELTA MAP ──────────────────────────────────────────────────────────

function renderDeltaMap(deltaData, worldTopo, regionalMap) {
  const container = document.getElementById('viz-map');
  const W = Math.min(container.parentElement.clientWidth || window.innerWidth * 0.9, 1180);
  const H = Math.round(W * 0.50);

  const projection = d3.geoNaturalEarth1()
    .scale(W / 6.3)
    .translate([W / 2, H / 2]);

  const path = d3.geoPath().projection(projection);
  const countries = topojson.feature(worldTopo, worldTopo.objects.countries);

  const svg = d3.select('#viz-map').append('svg')
    .attr('width', W)
    .attr('height', H)
    .style('display', 'block')
    .style('margin', '0 auto')
    .attr('class', 'viz-svg');

  svg.append('rect')
    .attr('width', W)
    .attr('height', H)
    .attr('fill', '#010a14');

  svg.append('path')
    .datum(d3.geoGraticule().step([30, 30])())
    .attr('d', path)
    .attr('fill', 'none')
    .attr('stroke', '#0a2540')
    .attr('stroke-width', 0.45)
    .attr('opacity', 0.4);

  // ── Lat-band polygons ─────────────────────────────────────────────────────
  const LAT_BANDS = [
    { basin: 'Arctic',         lat1: 60,  lat2: 90  },
    { basin: 'N. Temperate',   lat1: 30,  lat2: 60  },
    { basin: 'Tropical',       lat1: -30, lat2: 30  },
    { basin: 'S. Temperate',   lat1: -60, lat2: -30 },
    { basin: 'Southern Ocean', lat1: -90, lat2: -60 },
  ];

  const bandColorScale = d3.scaleSequential()
    .domain([0, -0.14])
    .interpolator(d3.interpolateRgbBasis(['#e2f0f7', '#f4a261', '#ff4d6d']))
    .clamp(true);

  const sliderEl = document.getElementById('map-year-slider');
  const yearReadout = d3.select('#map-year-readout');

  // Clip bands to the Natural Earth oval
  svg.append('defs').append('clipPath').attr('id', 'globe-clip')
    .append('path').datum({ type: 'Sphere' }).attr('d', path);

  // Use SVG rects positioned at projected lat coordinates — avoids all GeoJSON
  // winding-order issues near the poles that arise with d3's spherical renderer
  const bandPaths = svg.append('g').attr('class', 'band-layer').attr('clip-path', 'url(#globe-clip)')
    .selectAll('.lat-band')
    .data(LAT_BANDS)
    .enter().append('rect')
    .attr('class', 'lat-band')
    .attr('x', 0)
    .attr('width', W)
    .attr('y', d => {
      const py1 = (projection([0, d.lat1]) || [0, 0])[1];
      const py2 = (projection([0, d.lat2]) || [0, 0])[1];
      return Math.min(py1, py2);
    })
    .attr('height', d => {
      const py1 = (projection([0, d.lat1]) || [0, 0])[1];
      const py2 = (projection([0, d.lat2]) || [0, 0])[1];
      return Math.abs(py2 - py1);
    })
    .attr('fill', '#e2f0f7')
    .attr('opacity', 0.82);

  // Land mask on top
  svg.append('path')
    .datum(countries)
    .attr('d', path)
    .attr('fill', '#0f1a24')
    .attr('stroke', '#1a3a52')
    .attr('stroke-width', 0.45)
    .attr('opacity', 0.96)
    .style('pointer-events', 'none');

  function updateBands(year) {
    bandPaths.attr('fill', d => {
      const ph1850 = regionalMap.get(d.basin)?.get(1850);
      const phYear = regionalMap.get(d.basin)?.get(year);
      return (ph1850 != null && phYear != null) ? bandColorScale(phYear - ph1850) : '#334';
    });
    yearReadout.text(year);
    const pct = ((year - 1850) / (2014 - 1850)) * 100;
    sliderEl.style.background = `linear-gradient(to right, var(--teal) ${pct}%, #0e2a3d ${pct}%)`;
  }

  // Cross-link with Viz 2 regional chart hover
  updateMapRegionFocus = basin => {
    bandPaths
      .attr('opacity', d => !basin || d.basin === basin ? 0.88 : 0.28)
      .attr('stroke', d => basin && d.basin === basin ? 'rgba(144,224,239,0.55)' : 'none')
      .attr('stroke-width', 2);
  };

  bandPaths
    .on('mouseover', (event, d) => {
      const year = +sliderEl.value;
      const ph1850 = regionalMap.get(d.basin)?.get(1850);
      const phYear = regionalMap.get(d.basin)?.get(year);
      const delta = (ph1850 != null && phYear != null) ? phYear - ph1850 : null;
      showTooltip(event,
        `<strong>${d.basin}</strong><br>` +
        `${year} pH: ${phYear?.toFixed(4) ?? '—'}<br>` +
        `<span style="color:#ff4d6d">Δ from 1850: ${delta?.toFixed(4) ?? '—'}</span>`);
    })
    .on('mousemove', moveTooltip)
    .on('mouseout', hideTooltip);

  sliderEl.addEventListener('input', () => updateBands(+sliderEl.value));

  updateBands(1850);

  document.getElementById('section-map')._animate = () => {
    bandPaths.attr('opacity', 0)
      .transition().duration(900)
      .delay((d, i) => i * 100)
      .attr('opacity', 0.82);
  };

  d3.select('#viz-map')
    .style('position', 'relative')
    .style('height', H + 'px')
    .style('max-width', W + 'px')
    .style('margin', '0 auto');

  renderMapLegend(0, -0.14, bandColorScale);
  renderMapNotes();
}

function renderMapNotes() {
  d3.select('#map-annotation-cards').remove();

  const notes = [
    {
      title: 'Polar regions shift fastest',
      text: 'The strongest red bands appear near Arctic and Southern Ocean waters, showing that acidification is not evenly distributed.'
    },
    {
      title: 'Tropical regions are more stable',
      text: 'The tropical band shows lighter colors, meaning its pH changed less than high-latitude regions.'
    },
    {
      title: 'Drag the slider to see the change',
      text: 'The map starts at the 1850 baseline — all blue. Drag right toward 2014 to watch the poles redden decades before the tropics.'
    }
  ];

  const wrap = d3.select('#section-map')
    .append('div')
    .attr('id', 'map-annotation-cards');

  const cards = wrap.selectAll('.map-note-card')
    .data(notes)
    .enter()
    .append('div')
    .attr('class', 'map-note-card');

  cards.append('h4')
    .text(d => d.title);

  cards.append('p')
    .text(d => d.text);
}

function renderMapLegend(lessChange, mostAcidified, colorScale) {
  const lW = 220;
  const lH = 14;

  const svg = d3.select('#legend-svg')
    .attr('width', lW + 8)
    .attr('height', lH + 22);

  svg.selectAll('*').remove();

  const defs = svg.append('defs');

  const grad = defs.append('linearGradient')
    .attr('id', 'delta-grad')
    .attr('x1', '0%')
    .attr('x2', '100%');

  d3.range(0, 1.01, 0.05).forEach(t => {
    const value = lessChange + t * (mostAcidified - lessChange);

    grad.append('stop')
      .attr('offset', `${t * 100}%`)
      .attr('stop-color', colorScale(value));
  });

  svg.append('rect')
    .attr('width', lW)
    .attr('height', lH)
    .attr('rx', 3)
    .attr('fill', 'url(#delta-grad)');

  svg.append('text')
    .attr('x', 0)
    .attr('y', lH + 14)
    .attr('fill', '#7fb3c8')
    .style('font-size', '10px')
    .text(lessChange.toFixed(3));

  svg.append('text')
    .attr('x', lW)
    .attr('y', lH + 14)
    .attr('text-anchor', 'end')
    .attr('fill', '#7fb3c8')
    .style('font-size', '10px')
    .text(mostAcidified.toFixed(3));
}

// ── VIZ 4: REGIONAL DEPTH EXPLORER ───────────────────────────────────────────

const EXPLORER_REGION_COLORS = {
  'Arctic':        '#ff4d6d',
  'N. Temperate':  '#f4a261',
  'Tropical':      '#90e0ef',
  'S. Temperate':  '#48cae4',
  'Southern Ocean':'#0077b6',
  'High Arctic':   '#ff8fa3',
  'Subpolar':      '#ffd166',
  'Deep Tropics':  '#06d6a0',
};

const EXPLORER_REGION_ORDER = [
  'Arctic', 'N. Temperate', 'Tropical', 'S. Temperate', 'Southern Ocean',
  'High Arctic', 'Subpolar', 'Deep Tropics',
];

function getExplorerBasin(lat) {
  if (lat > 70)  return 'High Arctic';
  if (lat > 60)  return 'Subpolar';
  if (lat > 30)  return 'N. Temperate';
  if (lat > 15)  return null;            // upper tropics — not a separate band
  if (lat > -15) return 'Deep Tropics';
  if (lat > -30) return null;            // lower tropics
  if (lat > -60) return 'S. Temperate';
  return 'Southern Ocean';
}

function aggregateExplorerRegions(data) {
  // 5 standard lat bands (same definition as Viz 2)
  const standardMap = d3.rollup(
    data,
    v => d3.mean(v, d => d.ph),
    d => getBasin(d.lat),
    d => d.year
  );

  const standard = REGION_ORDER.map(basin => ({
    basin,
    values: Array.from(standardMap.get(basin) || [], ([year, ph]) => ({ year, ph }))
              .sort((a, b) => a.year - b.year),
  }));

  // 3 finer-grained bands
  const fineRows = data.filter(d => getExplorerBasin(d.lat) !== null);
  const fineMap = d3.rollup(
    fineRows,
    v => d3.mean(v, d => d.ph),
    d => getExplorerBasin(d.lat),
    d => d.year
  );

  const fine = ['High Arctic', 'Subpolar', 'Deep Tropics'].map(basin => ({
    basin,
    values: Array.from(fineMap.get(basin) || [], ([year, ph]) => ({ year, ph }))
              .sort((a, b) => a.year - b.year),
  }));

  return [...standard, ...fine];
}

function renderDepthExplorer(allExplorerSeries, data, worldTopo) {
  // ── Pre-process data ──────────────────────────────────────────────────────
  // Per-cell year→pH lookup. Key uses raw lon (may be >180) to match data.
  const cellYearPH = new Map();
  data.forEach(d => {
    const key = `${d.lat},${d.lon}`;
    if (!cellYearPH.has(key)) cellYearPH.set(key, new Map());
    cellYearPH.get(key).set(d.year, d.ph);
  });

  // pH → color: high pH (healthy) = cool blue, low pH (acidified) = red
  const sortedPH = data.map(d => d.ph).filter(Number.isFinite).sort(d3.ascending);
  const phLow  = d3.quantile(sortedPH, 0.01);
  const phHigh = d3.quantile(sortedPH, 0.99);
  const phColor = d3.scaleSequential()
    .domain([phHigh, phLow])
    .interpolator(d3.interpolateRgbBasis(['#caf0f8', '#90e0ef', '#f4a261', '#ff4d6d']))
    .clamp(true);

  // ── Map setup ─────────────────────────────────────────────────────────────
  const container = document.getElementById('viz-depth-sticky');
  container.style.position = 'relative';

  const W = container.clientWidth || 640;
  const H = container.clientHeight || 400;

  const projection = d3.geoNaturalEarth1().scale(W / 6.3).translate([W / 2, H / 2]);
  const geoPath    = d3.geoPath().projection(projection);
  const countries  = topojson.feature(worldTopo, worldTopo.objects.countries);

  // Unique cells with projected pixel coords; rawKey matches cellYearPH keys
  const seenCells = new Map();
  data.forEach(d => {
    const rawKey = `${d.lat},${d.lon}`;
    if (!seenCells.has(rawKey)) {
      const lon = d.lon > 180 ? d.lon - 360 : d.lon;
      const [px, py] = projection([lon, d.lat]) || [];
      if (px != null && !isNaN(px))
        seenCells.set(rawKey, { lat: d.lat, lon, rawKey, basin: getBasin(d.lat), px, py });
    }
  });
  const cells = Array.from(seenCells.values());

  const dotR = Math.max(3.6, Math.min(5.0, W / 220));

  // Main map SVG — viewBox will be animated to zoom into each region
  const svg = d3.select('#viz-depth-sticky').append('svg')
    .attr('width', W).attr('height', H)
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('class', 'viz-svg depth-map-svg')
    .style('display', 'block');

  svg.append('rect').attr('width', W).attr('height', H).attr('fill', '#010a14');

  const graticulePath = svg.append('path')
    .datum(d3.geoGraticule().step([30, 30])())
    .attr('d', geoPath).attr('fill', 'none')
    .attr('stroke', '#0a2540').attr('stroke-width', 0.45).attr('opacity', 0.35);

  const dots = svg.append('g')
    .selectAll('.depth-map-dot')
    .data(cells).enter().append('circle')
    .attr('class', 'depth-map-dot')
    .attr('cx', d => d.px).attr('cy', d => d.py)
    .attr('r', dotR)
    .attr('fill', d => {
      const ph = cellYearPH.get(d.rawKey)?.get(1850);
      return ph != null ? phColor(ph) : '#444';
    })
    .attr('opacity', 0.82);

  svg.append('path').datum(countries)
    .attr('d', geoPath)
    .attr('fill', '#0f1a24').attr('stroke', '#1a3a52')
    .attr('stroke-width', 0.45).attr('opacity', 0.96)
    .style('pointer-events', 'none');

  // ── Overlaid year label (HTML over SVG, unaffected by viewBox zoom) ───────
  const yearLabel = document.createElement('div');
  yearLabel.className = 'depth-year-label';
  container.appendChild(yearLabel);

  // ── Inset trend chart (separate absolutely-positioned SVG) ────────────────
  const iW = 230, iH = 132;
  const iM = { top: 26, right: 14, bottom: 22, left: 44 };
  const iiW = iW - iM.left - iM.right;
  const iiH = iH - iM.top - iM.bottom;

  const mainSeries = allExplorerSeries.filter(s => REGION_ORDER.includes(s.basin));
  const allVals    = mainSeries.flatMap(s => s.values);
  const xIns = d3.scaleLinear().domain([1850, 2014]).range([0, iiW]);
  const yIns = d3.scaleLinear()
    .domain([d3.min(allVals, d => d.ph) - 0.004, d3.max(allVals, d => d.ph) + 0.004])
    .range([iiH, 0]);
  const lineGen = d3.line().x(d => xIns(d.year)).y(d => yIns(d.ph)).curve(d3.curveCatmullRom);

  const insetSvg = d3.select('#viz-depth-sticky').append('svg')
    .attr('width', iW).attr('height', iH)
    .style('position', 'absolute').style('bottom', '12px').style('right', '12px')
    .style('pointer-events', 'none');

  insetSvg.append('rect').attr('width', iW).attr('height', iH).attr('rx', 7)
    .attr('fill', 'rgba(2,13,26,0.88)')
    .attr('stroke', 'rgba(0,180,216,0.22)').attr('stroke-width', 1);

  const insetG = insetSvg.append('g').attr('transform', `translate(${iM.left},${iM.top})`);

  insetG.append('g').attr('transform', `translate(0,${iiH})`)
    .call(d3.axisBottom(xIns).ticks(4).tickFormat(d3.format('d')))
    .call(g => { g.select('.domain').attr('stroke','#0e2a3d'); g.selectAll('text').attr('fill','#7fb3c8').style('font-size','8px'); });
  insetG.append('g')
    .call(d3.axisLeft(yIns).ticks(4).tickFormat(d3.format('.3f')))
    .call(g => { g.select('.domain').attr('stroke','#0e2a3d'); g.selectAll('text').attr('fill','#7fb3c8').style('font-size','8px'); });

  const insetTitle = insetSvg.append('text')
    .attr('x', iW / 2).attr('y', 14).attr('text-anchor', 'middle')
    .style('font-size', '9.5px').style('font-weight', '700').attr('fill', '#90e0ef');

  const insetLine = insetG.append('path')
    .attr('fill', 'none').attr('stroke-width', 2).attr('opacity', 0);

  // Playhead: vertical rule + dot + label
  const playhead = insetG.append('g').attr('opacity', 0);
  playhead.append('line').attr('class', 'ph-rule')
    .attr('y1', 0).attr('y2', iiH)
    .attr('stroke', '#90e0ef').attr('stroke-width', 1)
    .attr('stroke-dasharray', '3,3').attr('opacity', 0.75);
  const phDot = playhead.append('circle').attr('r', 3.5).attr('fill', '#90e0ef');
  const phLabel = playhead.append('text')
    .attr('text-anchor', 'middle').attr('fill', '#90e0ef').style('font-size', '8px');

  // ── State ─────────────────────────────────────────────────────────────────
  let activeBasin = null;
  let lastYear    = -1;

  // ── updateMapToYear ───────────────────────────────────────────────────────
  function updateMapToYear(year) {
    if (year === lastYear) return;
    lastYear = year;
    yearLabel.textContent = year;

    // Recolor only the active region's dots (others stay static)
    dots.filter(d => d.basin === activeBasin)
      .attr('fill', d => {
        const ph = cellYearPH.get(d.rawKey)?.get(year);
        return ph != null ? phColor(ph) : '#444';
      });

    // Move playhead
    const px = xIns(year);
    playhead.select('.ph-rule').attr('x1', px).attr('x2', px);

    const activeSeries = allExplorerSeries.find(s => s.basin === activeBasin);
    if (activeSeries) {
      const pt = activeSeries.values.find(v => v.year === year);
      if (pt) {
        phDot.attr('cx', px).attr('cy', yIns(pt.ph));
        phLabel.attr('x', px).attr('y', -5).text(year);
      }
    }
  }

  // ── zoomToRegion: animate viewBox to fit the region's dots ───────────────
  function zoomToRegion(basin) {
    const regionCells = cells.filter(d => d.basin === basin);
    if (!regionCells.length) return;

    const x0 = d3.min(regionCells, d => d.px);
    const x1 = d3.max(regionCells, d => d.px);
    const y0 = d3.min(regionCells, d => d.py);
    const y1 = d3.max(regionCells, d => d.py);

    // Padding: more horizontal (continents extend past dots) than vertical
    const padX = Math.max(28, (x1 - x0) * 0.04);
    const padY = Math.max(28, (y1 - y0) * 0.18);

    svg.transition().duration(750).ease(d3.easeCubicInOut)
      .attr('viewBox', `${x0 - padX} ${y0 - padY} ${x1 - x0 + 2 * padX} ${y1 - y0 + 2 * padY}`);
  }

  function zoomToGlobal() {
    svg.transition().duration(750).ease(d3.easeCubicInOut)
      .attr('viewBox', `0 0 ${W} ${H}`);
  }

  // ── setActiveRegion ───────────────────────────────────────────────────────
  function setActiveRegion(basin) {
    // Resolve fine-grained bands to their parent for map zoom / dot highlight
    const mapBasin = REGION_ORDER.includes(basin) ? basin
      : basin === 'High Arctic' || basin === 'Subpolar' ? 'Arctic'
      : basin === 'Deep Tropics' ? 'Tropical'
      : basin;

    activeBasin = mapBasin;
    lastYear = -1;

    const series = allExplorerSeries.find(s => s.basin === basin);
    const color  = EXPLORER_REGION_COLORS[basin] || '#00b4d8';

    // Zoom the viewBox
    zoomToRegion(mapBasin);

    // Dim non-region dots; colorize region dots to 1850 baseline
    dots.interrupt()
      .transition().duration(400)
      .attr('opacity', d => d.basin === mapBasin ? 0.90 : 0.07)
      .attr('r',       d => d.basin === mapBasin ? dotR * 1.1 : dotR * 0.7)
      .attr('fill',    d => {
        if (d.basin !== mapBasin) return '#334';
        const ph = cellYearPH.get(d.rawKey)?.get(1850);
        return ph != null ? phColor(ph) : '#444';
      });

    // Inset: draw this region's trend line
    if (series) {
      insetTitle.attr('fill', color).text(basin);
      insetLine.attr('stroke', color).attr('d', lineGen(series.values))
        .attr('stroke-dasharray', function() { const l = this.getTotalLength(); return `${l} ${l}`; })
        .attr('stroke-dashoffset', function() { return this.getTotalLength(); })
        .attr('opacity', 1)
        .transition().duration(600).ease(d3.easeCubicInOut).attr('stroke-dashoffset', 0);
    }

    playhead.attr('opacity', 1);
    updateMapToYear(1850);

  }

  // ── Scrollama ─────────────────────────────────────────────────────────────
  const scroller = scrollama();
  scroller
    .setup({ step: '#scrollama-steps .step', offset: 0.5, progress: true })
    .onStepEnter(({ element }) => {
      document.querySelectorAll('#scrollama-steps .step').forEach(el => el.classList.remove('is-active'));
      element.classList.add('is-active');
      setActiveRegion(element.dataset.region);
    })
    .onStepProgress(({ progress }) => {
      updateMapToYear(Math.round(1850 + progress * 164));
    });

  window.addEventListener('resize', scroller.resize);

  // Default: activate first step
  const firstStep = document.querySelector('#scrollama-steps .step');
  if (firstStep) {
    firstStep.classList.add('is-active');
    setActiveRegion(firstStep.dataset.region);
  }
}

// ── SCROLL OBSERVER ───────────────────────────────────────────────────────────

function setupObserver() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      el.classList.add('visible');

      if (el.id === 'section-trend' && !el._done) {
        el._done = true;
        setTimeout(() => el._animate?.(), 300);
      }
      if (el.id === 'section-regional' && !el._done) {
        el._done = true;
        setTimeout(() => el._animate?.(), 200);
      }
      if (el.id === 'section-map' && !el._done) {
        el._done = true;
        setTimeout(() => el._animate?.(), 150);
      }
      if (el.id === 'section-depth' && !el._done) {
        el._done = true;
      }
      if (el.id === 'section-stakes' && !el._done) {
        el._done = true;
        document.querySelectorAll('.stake-card').forEach((card, i) => {
          setTimeout(() => card.classList.add('visible'), i * 160);
        });
      }

      observer.unobserve(el);
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.scroll-reveal').forEach(el => observer.observe(el));
}
