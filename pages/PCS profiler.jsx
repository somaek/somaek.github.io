import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Upload, FileText, Activity, Mountain, TrendingUp, Info, RotateCw } from 'lucide-react';

/**
 * UTILITY FUNCTIONS
 */

// Calculate distance between two lat/lon points in km
const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Moving average smoothing to reduce GPS noise
const smoothElevation = (points, windowSize = 5) => {
  return points.map((point, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - windowSize); j <= Math.min(points.length - 1, i + windowSize); j++) {
      sum += points[j].ele;
      count++;
    }
    return { ...point, ele: sum / count };
  });
};

const App = () => {
  const [dragActive, setDragActive] = useState(false);
  const [fileData, setFileData] = useState(null);
  const [baseData, setBaseData] = useState(null); // Store single lap data
  const [laps, setLaps] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  // Recalculate when base data or laps change
  useEffect(() => {
    if (!baseData) return;

    // Generate multi-lap points
    let fullPoints = [];
    for (let i = 0; i < laps; i++) {
      const lapOffset = i * baseData.distance;
      // Map points, adding the offset to the distance
      // We perform a shallow copy of the point to avoid mutating baseData
      const lapPoints = baseData.points.map(p => ({
        ...p,
        dist: p.dist + lapOffset
      }));
      fullPoints = fullPoints.concat(lapPoints);
    }

    const totalDistance = baseData.distance * laps;
    analyzeRoute(fullPoints, totalDistance);
  }, [baseData, laps]);

  const processGPX = (text) => {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, 'text/xml');
      const trkpts = xmlDoc.getElementsByTagName('trkpt');

      if (trkpts.length === 0) {
        // Use custom modal or console log instead of alert
        console.error('No track points found in GPX file.');
        return;
      }

      let rawPoints = [];
      for (let i = 0; i < trkpts.length; i++) {
        const p = trkpts[i];
        const lat = parseFloat(p.getAttribute('lat'));
        const lon = parseFloat(p.getAttribute('lon'));
        const ele = parseFloat(p.getElementsByTagName('ele')[0]?.textContent || 0);
        rawPoints.push({ lat, lon, ele });
      }

      // Calculate cumulative distance
      let totalDist = 0;
      let pointsWithDist = rawPoints.map((p, i) => {
        if (i > 0) {
          totalDist += haversineDistance(
            rawPoints[i - 1].lat,
            rawPoints[i - 1].lon,
            p.lat,
            p.lon
          );
        }
        return { ...p, dist: totalDist };
      });

      // Smooth elevation to handle GPS jitter
      const smoothedPoints = smoothElevation(pointsWithDist, 3);
      
      // Reset laps to 1 on new file and store base data
      setLaps(1);
      setBaseData({
        points: smoothedPoints,
        distance: totalDist
      });
      
    } catch (error) {
      console.error(error);
      // Use custom modal or console log instead of alert
      console.error('Error parsing GPX file.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file) => {
    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      processGPX(e.target.result);
    };
    reader.readAsText(file);
  };

  const analyzeRoute = (points, totalDistance) => {
    // 1. Detect Climbs
    // Heuristic: We calculate gradients over small chunks (e.g., 200m)
    // Then we group contiguous uphill chunks into "Climbs"
    // We ignore very small dips to keep climbs unified
    
    const CHUNK_SIZE = 0.2; // 200 meters as per PCS methodology snippet
    let chunks = [];
    
    for (let i = 0; i < points.length; i++) {
      const start = points[i];
      let j = i + 1;
      while (j < points.length && points[j].dist - start.dist < CHUNK_SIZE) {
        j++;
      }
      if (j < points.length) {
        const end = points[j];
        const dist = end.dist - start.dist;
        const gain = end.ele - start.ele;
        const gradient = (gain / (dist * 1000)) * 100;
        chunks.push({ startDist: start.dist, endDist: end.dist, gradient, gain, startEle: start.ele, endEle: end.ele });
        i = j - 1; // Advance
      }
    }

    // Group chunks into climbs
    let climbs = [];
    let currentClimb = null;

    chunks.forEach((chunk) => {
      // Threshold to consider a chunk part of a climb (e.g., > 1% grade)
      // PCS includes flat sections in a climb if between steeps, but we need a cutoff
      const isUphill = chunk.gradient > 1.5; 

      if (isUphill) {
        if (!currentClimb) {
          currentClimb = {
            startDist: chunk.startDist,
            endDist: chunk.endDist,
            gain: chunk.gain,
            chunks: [chunk]
          };
        } else {
          // Extend current climb
          currentClimb.endDist = chunk.endDist;
          currentClimb.gain += chunk.gain;
          currentClimb.chunks.push(chunk);
        }
      } else {
        // If we hit a flat/downhill, should we end the climb?
        // Logic: if it's short (e.g. < 500m) and we go up again, keep it.
        // For simplicity in this demo, we end the climb if we see 2 consecutive non-uphill chunks or a significant drop
        if (currentClimb) {
           // Close the climb
           climbs.push(currentClimb);
           currentClimb = null;
        }
      }
    });
    if (currentClimb) climbs.push(currentClimb);

    // Filter noise: Climbs must have at least X meters gain or Y length to count for PCS logic usually
    // We will keep anything over 20m gain for visibility
    const validClimbs = climbs.filter(c => c.gain > 20).map(c => {
      const lengthKm = c.endDist - c.startDist;
      const gradientAvg = (c.gain / (lengthKm * 1000)) * 100;
      
      // PCS Formula: (Steepness / 2)^2 * Length
      const rawScore = Math.pow(gradientAvg / 2, 2) * lengthKm;

      // Distance from finish logic
      const distFromFinish = totalDistance - c.endDist; // Using summit as reference
      let multiplier = 0.2;
      
      if (distFromFinish <= 10) multiplier = 1.0;
      else if (distFromFinish <= 25) multiplier = 0.8;
      else if (distFromFinish <= 50) multiplier = 0.6;
      else if (distFromFinish <= 75) multiplier = 0.4;
      else multiplier = 0.2;

      return {
        ...c,
        lengthKm,
        gradientAvg,
        rawScore,
        multiplier,
        finalScore: rawScore * multiplier,
        distFromFinish
      };
    });

    const totalScore = validClimbs.reduce((acc, c) => acc + c.finalScore, 0);
    
    // "Final" Score (Last 25km only)
    const finalZoneStart = totalDistance - 25;
    const finalClimbs = validClimbs.filter(c => c.endDist >= finalZoneStart);
    
    // For the "Final Score" PCS rule: "Same formula but applied only to last 25km"
    // We will sum the final scores of climbs of climbs in the final 25km
    const finalProfileScore = finalClimbs.reduce((acc, c) => acc + c.finalScore, 0);

    /* --- TPV Climb Weighting Logic (Including < 20km rule) --- */
    
    let tpvClimbWeightingRatio;

    // Intermediate metrics (still useful for context)
    const overallMetric = totalScore / 100; 
    const finalZoneRatioUncapped = totalDistance > 0 ? finalProfileScore / 25 : 0; 
    const finalZoneMetricCapped = Math.min(finalZoneRatioUncapped, 0.8); // Cap the contribution ratio at 0.8


    if (totalDistance > 0 && totalDistance < 20) {
        // New Rule: If course is less than 20km, use Score / Length
        tpvClimbWeightingRatio = totalScore / totalDistance;
    } else {
        // Existing Rule: For courses 20km or longer
        tpvClimbWeightingRatio = Math.max(overallMetric, finalZoneMetricCapped);
    }


    // Convert to percentage and cap at 100%
    const tpvClimbWeighting = Math.min(tpvClimbWeightingRatio * 100, 100);

    /* --- Total Climbing (Gross Gain) Calculation --- */
    let totalClimbing = 0;
    for (let i = 1; i < points.length; i++) {
        const elevationChange = points[i].ele - points[i - 1].ele;
        if (elevationChange > 0) {
            totalClimbing += elevationChange;
        }
    }
    
    setFileData({
      points,
      totalDistance,
      totalClimbing, // Added Gross Total Climbing
      totalGain: points[points.length-1].ele - points[0].ele, // Net gain (simplification)
      maxEle: Math.max(...points.map(p => p.ele)),
      minEle: Math.min(...points.map(p => p.ele)),
      climbs: validClimbs,
      totalScore,
      finalProfileScore,
      tpvClimbWeighting, // Updated TPV metric
      overallMetric,
      finalZoneMetric: finalZoneMetricCapped // This is the capped ratio (max 0.8)
    });
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-blue-500 selection:text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex items-center space-x-3 border-b border-slate-700 pb-6">
          <Activity className="w-8 h-8 text-blue-500" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">PCS Profile Score Calculator</h1>
            <p className="text-slate-400 text-sm">Upload a GPX file to analyze course difficulty based on ProCyclingStats methodology.</p>
          </div>
        </header>

        {/* Input Section */}
        {!fileData && (
          <div 
            className={`
              border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer
              ${dragActive ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 hover:border-slate-500 bg-slate-800'}
            `}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              ref={fileInputRef}
              type="file" 
              accept=".gpx" 
              className="hidden" 
              onChange={handleChange} 
            />
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 bg-slate-700 rounded-full flex items-center justify-center">
                <Upload className="w-8 h-8 text-slate-300" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-white">Upload Route File</h3>
                <p className="text-slate-400 mt-1">Drag & drop a .gpx file here, or click to browse</p>
              </div>
              {isProcessing && <p className="text-blue-400 animate-pulse">Processing route data...</p>}
            </div>
          </div>
        )}

        {/* Results Dashboard */}
        {fileData && (
          <div className="space-y-6">

            {/* Controls Bar */}
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                 <div className="bg-slate-700 p-2 rounded-lg">
                    <RotateCw className="w-5 h-5 text-blue-400" />
                 </div>
                 <div>
                    <h3 className="font-semibold text-sm text-slate-200">Course Laps</h3>
                    <p className="text-xs text-slate-400">Multiplies distance, affects finish proximity</p>
                 </div>
              </div>
              <div className="flex items-center gap-4">
                 <div className="flex items-center bg-slate-900 rounded-lg p-1 border border-slate-700">
                    <button 
                      onClick={() => setLaps(Math.max(1, laps - 1))}
                      className="px-3 py-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
                    >-</button>
                    <div className="w-12 text-center font-mono font-bold text-lg text-blue-400">{laps}</div>
                    <button 
                      onClick={() => setLaps(Math.max(1, laps + 1))}
                      className="px-3 py-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
                    >+</button>
                 </div>
              </div>
            </div>
            
            {/* Top Stats Cards - Adjusted grid for 5 cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <StatCard 
                title="Profile Score" 
                value={Math.round(fileData.totalScore)} 
                icon={<Activity className="w-5 h-5 text-blue-400" />}
                highlight
              />
              <StatCard 
                title="TPV Climb Weighting" 
                value={`${Math.round(fileData.tpvClimbWeighting)}%`} 
                icon={<RotateCw className="w-5 h-5 text-purple-400" />}
              />
               <StatCard 
                title="Final Score (Last 25k)" 
                value={Math.round(fileData.finalProfileScore)} 
                icon={<TrendingUp className="w-5 h-5 text-emerald-400" />}
              />
              <StatCard 
                title="Total Distance" 
                value={`${fileData.totalDistance.toFixed(1)} km`} 
                icon={<FileText className="w-5 h-5 text-orange-400" />}
              />
              {/* Total Climbing Card */}
              <StatCard 
                title="Total Climbing" 
                value={`${Math.round(fileData.totalClimbing)} m`} 
                icon={<Mountain className="w-5 h-5 text-cyan-400" />}
              />
            </div>

            {/* Elevation Profile Graph */}
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl overflow-hidden">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <Mountain className="w-5 h-5 text-slate-400" />
                  Elevation Profile
                </h3>
                <div className="flex gap-4 text-xs">
                  <span className="flex items-center gap-1"><div className="w-3 h-3 bg-red-500 rounded-full"></div> Detect Climb</span>
                  <span className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500 rounded-full"></div> Flat/Descent</span>
                </div>
              </div>
              
              <div className="h-64 w-full relative">
                 <ElevationChart 
                    points={fileData.points} 
                    climbs={fileData.climbs} 
                    totalDistance={fileData.totalDistance}
                    minEle={fileData.minEle}
                    maxEle={fileData.maxEle}
                 />
              </div>
            </div>

            {/* Detected Climbs Table */}
            <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
              <div className="p-6 border-b border-slate-700 bg-slate-800/50">
                <h3 className="font-semibold text-lg">Scored Climbs</h3>
                <p className="text-slate-400 text-sm mt-1">Climbs identified based on &gt;1.5% sustained gradient and &gt;20m gain.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-slate-400 bg-slate-900/50 uppercase text-xs">
                    <tr>
                      <th className="px-6 py-3">Location (km)</th>
                      <th className="px-6 py-3">Length</th>
                      <th className="px-6 py-3">Avg Grade</th>
                      <th className="px-6 py-3">Difficulty (Raw)</th>
                      <th className="px-6 py-3">To Finish</th>
                      <th className="px-6 py-3">Factor</th>
                      <th className="px-6 py-3 text-right">Points</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {fileData.climbs.length === 0 ? (
                      <tr><td colSpan="7" className="p-6 text-center text-slate-500">No significant climbs detected.</td></tr>
                    ) : (
                      fileData.climbs.map((climb, idx) => (
                        <tr key={idx} className="hover:bg-slate-700/30 transition-colors">
                          <td className="px-6 py-4 font-mono text-slate-300">
                            {climb.startDist.toFixed(1)} - {climb.endDist.toFixed(1)}
                          </td>
                          <td className="px-6 py-4">{climb.lengthKm.toFixed(2)} km</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded text-xs font-bold ${
                              climb.gradientAvg > 8 ? 'bg-red-500/20 text-red-400' : 
                              climb.gradientAvg > 5 ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400'
                            }`}>
                              {climb.gradientAvg.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-400">{Math.round(climb.rawScore)}</td>
                          <td className="px-6 py-4">{climb.distFromFinish.toFixed(1)} km</td>
                          <td className="px-6 py-4">x{climb.multiplier}</td>
                          <td className="px-6 py-4 text-right font-bold text-white">
                            {climb.finalScore.toFixed(1)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Methodology Note - Corrected JSX/Markdown */}
            <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4 flex gap-3 text-sm text-blue-200">
              <Info className="w-5 h-5 shrink-0" />
              <div>
                <p className="font-semibold mb-1">About Profile Score</p>
                
                <p className="opacity-80 mt-2">
                  The base formula for climb points is: <code>(Gradient/2)² * Length * PositionFactor</code>.
                </p>
                
                <p className="opacity-80 mt-2">
                  The **TPV Climb Weighting** is a percentage derived from one of two rules, based on course distance:
                </p>
                
                <ul className="list-disc list-inside ml-4 mt-1 opacity-80">
                  <li>
                    **If Total Distance {'<'} 20 km:** The ratio is calculated as <code>Profile Score / Total Distance</code>.
                  </li>
                  <li>
                    **If Total Distance {'\u2265'} 20 km:** The ratio is the maximum of:
                    <ul className="list-circle list-inside ml-6 mt-1">
                      <li>Overall Profile Score / 100</li>
                      <li>Final 25 km Profile Score / 25, **capped at a ratio of 0.8 (80%)**</li>
                    </ul>
                  </li>
                </ul>

                <p className="opacity-80 mt-2">
                  The resulting ratio is converted to a percentage and capped at 100%.
                </p>
              </div>
            </div>

            <div className="flex justify-center pt-8 pb-12">
               <button 
                  onClick={() => setFileData(null)}
                  className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors"
                >
                  Analyze Another File
               </button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon, highlight }) => (
  <div className={`
    p-5 rounded-xl border flex flex-col justify-between
    ${highlight ? 'bg-gradient-to-br from-blue-600/20 to-blue-900/20 border-blue-500/50' : 'bg-slate-800 border-slate-700'}
  `}>
    <div className="flex justify-between items-start mb-2">
      <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">{title}</span>
      {icon}
    </div>
    <div className={`text-2xl md:text-3xl font-bold ${highlight ? 'text-white' : 'text-slate-200'}`}>
      {value}
    </div>
  </div>
);

// Custom SVG Chart for zero-dependency rendering
const ElevationChart = ({ points, climbs, totalDistance, minEle, maxEle }) => {
  // Downsample for performance if too many points
  const displayPoints = useMemo(() => {
    if (points.length < 500) return points;
    const factor = Math.floor(points.length / 500);
    return points.filter((_, i) => i % factor === 0);
  }, [points]);

  const height = 250;
  const width = 800; // viewBox width
  const padding = 20;

  const getX = (dist) => padding + (dist / totalDistance) * (width - padding * 2);
  const getY = (ele) => height - padding - ((ele - minEle) / (maxEle - minEle) * (height - padding * 2));

  // Generate main path
  const pathD = displayPoints.map((p, i) => 
    `${i === 0 ? 'M' : 'L'} ${getX(p.dist)} ${getY(p.ele)}`
  ).join(' ');

  // Generate Fill (for area under curve)
  const fillD = `
    ${pathD} 
    L ${getX(displayPoints[displayPoints.length-1].dist)} ${height} 
    L ${getX(0)} ${height} 
    Z
  `;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full preserve-3d">
      {/* Grid Lines */}
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#334155" strokeWidth="1" />
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#334155" strokeWidth="1" />

      {/* Area Fill */}
      <path d={fillD} fill="url(#gradient)" opacity="0.5" />
      
      {/* Defs for Gradient */}
      <defs>
        <linearGradient id="gradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4"/>
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05"/>
        </linearGradient>
      </defs>

      {/* Main Line */}
      <path d={pathD} stroke="#3b82f6" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />

      {/* Highlight Climbs */}
      {climbs.map((climb, i) => {
        // We need to construct a path for just this climb segment
        // Filter points within range
        const climbPoints = points.filter(p => p.dist >= climb.startDist && p.dist <= climb.endDist);
        // Reduce resolution for rendering if needed, similar to main line
        const step = Math.max(1, Math.floor(climbPoints.length / 20));
        const pts = climbPoints.filter((_, idx) => idx % step === 0);
        
        if (pts.length < 2) return null;

        const d = pts.map((p, idx) => 
            `${idx === 0 ? 'M' : 'L'} ${getX(p.dist)} ${getY(p.ele)}`
        ).join(' ');

        // Color based on gradient
        const color = climb.gradientAvg > 8 ? '#ef4444' : climb.gradientAvg > 5 ? '#f97316' : '#10b981';

        return (
            <path key={i} d={d} stroke={color} strokeWidth="3" fill="none" />
        );
      })}

      {/* Labels */}
      <text x={padding} y={height} fill="#94a3b1" fontSize="10" dy="-5">0km</text>
      <text x={width-padding} y={height} fill="#94a3b1" fontSize="10" textAnchor="end" dy="-5">{totalDistance.toFixed(0)}km</text>
    </svg>
  );
};

export default App;
