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
  
  // New State for Road Book Fields
  const [raceTitle, setRaceTitle] = useState("Race Title");
  const [raceDescription, setRaceDescription] = useState("");

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

      const smoothedPoints = smoothElevation(pointsWithDist, 3);
      
      setLaps(1);
      setRaceTitle("New Race Profile");
      setRaceDescription("");
      setBaseData({
        points: smoothedPoints,
        distance: totalDist
      });
      
    } catch (error) {
      console.error(error);
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

  const updateClimbName = (index, value) => {
    setFileData(prev => {
        if (!prev) return null;
        const newClimbs = [...prev.climbs];
        newClimbs[index] = { ...newClimbs[index], name: value };
        return { ...prev, climbs: newClimbs };
    });
  };

  const analyzeRoute = (points, totalDistance) => {
    const CHUNK_SIZE = 0.2; 
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
        i = j - 1; 
      }
    }

    let climbs = [];
    let currentClimb = null;

    chunks.forEach((chunk) => {
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
          currentClimb.endDist = chunk.endDist;
          currentClimb.gain += chunk.gain;
          currentClimb.chunks.push(chunk);
        }
      } else {
        if (currentClimb) {
           climbs.push(currentClimb);
           currentClimb = null;
        }
      }
    });
    if (currentClimb) climbs.push(currentClimb);

    const validClimbs = climbs.filter(c => c.gain > 20).map(c => {
      const lengthKm = c.endDist - c.startDist;
      const gradientAvg = (c.gain / (lengthKm * 1000)) * 100;
      const maxGradient = Math.max(...c.chunks.map(chunk => chunk.gradient));
      const rawScore = Math.pow(gradientAvg / 2, 2) * lengthKm;

      const distFromFinish = totalDistance - c.endDist; 
      let multiplier = 0.2;
      
      if (distFromFinish <= 10) multiplier = 1.0;
      else if (distFromFinish <= 25) multiplier = 0.8;
      else if (distFromFinish <= 50) multiplier = 0.6;
      else if (distFromFinish <= 75) multiplier = 0.4;

      return {
        ...c,
        name: '',
        lengthKm,
        gradientAvg,
        maxGradient,
        rawScore,
        multiplier,
        finalScore: rawScore * multiplier,
        distFromFinish
      };
    });

    const totalScore = validClimbs.reduce((acc, c) => acc + c.finalScore, 0);
    const finalZoneStart = totalDistance - 25;
    const finalClimbs = validClimbs.filter(c => c.endDist >= finalZoneStart);
    const finalProfileScore = finalClimbs.reduce((acc, c) => acc + c.finalScore, 0);

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
      totalClimbing, 
      totalGain: points[points.length-1].ele - points[0].ele,
      maxEle: Math.max(...points.map(p => p.ele)),
      minEle: Math.min(...points.map(p => p.ele)),
      climbs: validClimbs,
      totalScore,
      finalProfileScore,
    });
  };

  return (
    // THEME UPDATE: Switched to Deep Purple (#3b0687) background and Bright Blue (#00B4FF) accents.
    <div className="min-h-screen bg-[#3b0687] text-white font-sans selection:bg-[#00B4FF] selection:text-black p-4 md:p-8">
      {/* Import Google Fonts */}
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Roboto:wght@300;400;500;700&display=swap');
          
          h1, h2, h3, h4, .font-oswald {
            font-family: 'Oswald', sans-serif;
          }
          body, p, input, textarea, td, th {
            font-family: 'Roboto', sans-serif;
          }
        `}
      </style>

      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Banner Image */}
        <div className="w-full rounded-sm overflow-hidden shadow-2xl print:hidden border-b-4 border-[#00B4FF]">
            <img 
                src="https://raw.githubusercontent.com/somaek/somaek.github.io/main/CLASSICS%20BANNER.png" 
                alt="ALLKIN CLASSICS FALL 2025 Banner" 
                className="w-full h-auto object-cover" 
            />
        </div>

        {/* Header (Text and Info) */}
        <header className="flex items-center space-x-4 border-b border-[#52259c] pb-6 print:hidden">
          <Activity className="w-8 h-8 text-[#00B4FF]" />
          <div>
            <h1 className="text-3xl font-bold tracking-wide uppercase text-white">Allkin Classics Road Book</h1>
            <p className="text-neutral-300 text-sm tracking-wide">Race Profile</p>
          </div>
        </header>
        
        {/* Input Section */}
        {!fileData && (
          <div 
            className={`
              border-2 border-dashed rounded-sm p-16 text-center transition-all cursor-pointer group
              ${dragActive ? 'border-[#00B4FF] bg-[#00B4FF]/10' : 'border-[#52259c] hover:border-[#00B4FF]/50 bg-[#481a95]'}
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
            <div className="flex flex-col items-center gap-6">
              <div className="w-20 h-20 bg-[#52259c] rounded-full flex items-center justify-center group-hover:bg-[#5e31a9] transition-colors">
                <Upload className="w-10 h-10 text-neutral-400 group-hover:text-[#00B4FF] transition-colors" />
              </div>
              <div>
                <h3 className="text-2xl font-bold uppercase text-white font-oswald tracking-wide">Upload Route File</h3>
                <p className="text-neutral-400 mt-2 font-light">Drag & drop a .gpx file here</p>
              </div>
              {isProcessing && <p className="text-[#00B4FF] font-bold animate-pulse tracking-widest uppercase">Processing...</p>}
            </div>
          </div>
        )}

        {/* Results Dashboard */}
        {fileData && (
          <div className="space-y-6">

            {/* Race Details Input */}
            <div className="bg-[#481a95] border border-[#5e31a9] rounded-sm p-6 space-y-5 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-[#00B4FF]"></div>
                <div>
                    <label className="block text-xs font-bold text-[#00B4FF] uppercase tracking-widest mb-2">Race Title</label>
                    <input 
                        type="text" 
                        value={raceTitle}
                        onChange={(e) => setRaceTitle(e.target.value)}
                        className="w-full bg-[#3b0687] border border-[#5e31a9] rounded-none px-4 py-3 text-3xl font-bold text-white uppercase font-oswald focus:outline-none focus:border-[#00B4FF] focus:ring-1 focus:ring-[#00B4FF] transition-all placeholder-neutral-500 print:text-black print:bg-white print:border-black"
                        placeholder="ENTER RACE NAME..."
                    />
                </div>
                <div>
                    <label className="block text-xs font-bold text-[#00B4FF] uppercase tracking-widest mb-2">Description / Notes</label>
                    <textarea 
                        value={raceDescription}
                        onChange={(e) => setRaceDescription(e.target.value)}
                        className="w-full bg-[#3b0687] border border-[#5e31a9] rounded-none px-4 py-3 text-neutral-200 focus:outline-none focus:border-[#00B4FF] focus:ring-1 focus:ring-[#00B4FF] h-24 resize-none transition-all placeholder-neutral-500 print:text-black print:bg-white print:border-black"
                        placeholder="Add race details, start time, or key segments..."
                    />
                </div>
            </div>

            {/* Controls Bar */}
            <div className="bg-[#481a95] rounded-sm p-4 border border-[#5e31a9] flex flex-wrap items-center justify-between gap-4 print:hidden">
              <div className="flex items-center gap-3">
                 <div className="bg-[#3b0687] p-2 rounded-sm">
                    <RotateCw className="w-5 h-5 text-[#00B4FF]" />
                 </div>
                 <div>
                    <h3 className="font-bold uppercase text-sm text-white font-oswald tracking-wide">Course Laps</h3>
                    <p className="text-xs text-neutral-400">Adjusts total distance & scoring</p>
                 </div>
              </div>
              <div className="flex items-center gap-4">
                 <div className="flex items-center bg-[#3b0687] rounded-sm p-1 border border-[#5e31a9]">
                    <button 
                      onClick={() => setLaps(Math.max(1, laps - 1))}
                      className="px-4 py-1 text-neutral-400 hover:text-white hover:bg-[#52259c] rounded-sm transition-colors font-bold"
                    >-</button>
                    <div className="w-12 text-center font-oswald font-bold text-xl text-[#00B4FF]">{laps}</div>
                    <button 
                      onClick={() => setLaps(laps + 1)} 
                      className="px-4 py-1 text-neutral-400 hover:text-white hover:bg-[#52259c] rounded-sm transition-colors font-bold"
                    >+</button>
                 </div>
              </div>
            </div>
            
            {/* Top Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard 
                title="Profile Score" 
                value={Math.round(fileData.totalScore)} 
                icon={<Activity className="w-5 h-5 text-[#00B4FF]" />}
                highlight
              />
               <StatCard 
                title="Final 25km Score" 
                value={Math.round(fileData.finalProfileScore)} 
                icon={<TrendingUp className="w-5 h-5 text-neutral-300" />}
              />
              <StatCard 
                title="Total Distance" 
                value={`${fileData.totalDistance.toFixed(1)} km`} 
                icon={<FileText className="w-5 h-5 text-neutral-300" />}
              />
              <StatCard 
                title="Total Climbing" 
                value={`${Math.round(fileData.totalClimbing)} m`} 
                icon={<Mountain className="w-5 h-5 text-neutral-300" />}
              />
            </div>
            
            {/* Elevation Profile Graph */}
            <div className="bg-[#481a95] rounded-sm p-6 border border-[#5e31a9] shadow-xl overflow-hidden print:bg-white print:border-black relative">
               <div className="absolute top-0 right-0 p-2 opacity-10 pointer-events-none">
                  <Mountain className="w-32 h-32 text-[#00B4FF]" />
               </div>
              <div className="flex justify-between items-center mb-6 relative z-10">
                <h3 className="font-bold text-xl uppercase tracking-wide flex items-center gap-2 font-oswald text-white print:text-black">
                  <span className="w-2 h-8 bg-[#00B4FF] inline-block mr-2"></span>
                  Elevation Profile
                </h3>
              </div>
              
              <div className="h-64 w-full relative z-10">
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
            <div className="bg-[#481a95] rounded-sm overflow-hidden border border-[#5e31a9] shadow-lg">
              <div className="p-5 border-b border-[#5e31a9] bg-[#3b0687] flex justify-between items-end">
                <div>
                    <h3 className="font-bold text-xl uppercase tracking-wide text-white font-oswald">Scored Climbs</h3>
                    <p className="text-[#00B4FF]/80 text-xs mt-1 uppercase tracking-wider font-bold">Manual Entry Required</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-neutral-400 bg-[#3b0687] uppercase text-xs font-bold tracking-wider font-oswald"><tr>
                      <th className="px-6 py-4 w-64 border-b border-[#5e31a9]">Climb Name</th>
                      <th className="px-6 py-4 border-b border-[#5e31a9]">Location (km)</th>
                      <th className="px-6 py-4 border-b border-[#5e31a9]">Length</th>
                      <th className="px-6 py-4 border-b border-[#5e31a9]">Avg %</th>
                      <th className="px-6 py-4 border-b border-[#5e31a9]">Max %</th>
                      <th className="px-6 py-4 border-b border-[#5e31a9]">Score</th>
                      <th className="px-6 py-4 border-b border-[#5e31a9] text-right">To Finish</th>
                    </tr></thead>
                  <tbody className="divide-y divide-[#5e31a9]">
                    {fileData.climbs.length === 0 ? (
                      <tr><td colSpan="7" className="p-8 text-center text-neutral-500 italic">No significant climbs detected.</td></tr>
                    ) : (
                      fileData.climbs.map((climb, idx) => (
                        <tr key={idx} className="hover:bg-[#52259c] transition-colors group">
                          <td className="px-6 py-3">
                             <input 
                                type="text"
                                placeholder="NAME..."
                                value={climb.name}
                                onChange={(e) => updateClimbName(idx, e.target.value)}
                                className="bg-[#3b0687] border border-[#5e31a9] rounded-none px-3 py-1 text-white w-full focus:border-[#00B4FF] focus:outline-none focus:ring-1 focus:ring-[#00B4FF] placeholder-neutral-500 uppercase font-bold text-sm print:text-black print:bg-white print:border-black transition-all"
                             />
                          </td>
                          <td className="px-6 py-4 font-mono text-neutral-300">
                            {climb.startDist.toFixed(1)} <span className="text-neutral-500 mx-1">/</span> {climb.endDist.toFixed(1)}
                          </td>
                          <td className="px-6 py-4 text-white font-medium">{climb.lengthKm.toFixed(2)} km</td>
                          {/* Avg Grade */}
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 text-xs font-bold uppercase tracking-wide ${
                              climb.gradientAvg > 8 ? 'text-red-400' : 
                              climb.gradientAvg > 5 ? 'text-orange-400' : 'text-lime-400'
                            }`}>
                              {climb.gradientAvg.toFixed(1)}%
                            </span>
                          </td>
                          {/* Max Grade */}
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 text-xs font-bold uppercase tracking-wide ${
                              climb.maxGradient > 12 ? 'bg-red-900/30 text-red-400' : 
                              climb.maxGradient > 8 ? 'bg-orange-900/30 text-orange-400' : 'bg-lime-900/30 text-lime-400'
                            }`}>
                              {climb.maxGradient.toFixed(1)}%
                            </span>
                          </td>
                          {/* Difficulty (Raw Score) */}
                          <td className="px-6 py-4 text-neutral-200 font-mono">{Math.round(climb.rawScore)}</td>
                          {/* To Finish */}
                          <td className="px-6 py-4 text-right text-white font-bold">{climb.distFromFinish.toFixed(1)} km</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Methodology Note - Updated */}
            <div className="bg-[#481a95] border border-[#5e31a9] rounded-sm p-5 flex gap-4 text-sm text-neutral-300 items-start">
              <Info className="w-5 h-5 shrink-0 text-[#00B4FF] mt-0.5" />
              <div>
                <p className="font-bold uppercase text-white font-oswald mb-1">Scoring Methodology</p>
                <p className="opacity-80 leading-relaxed font-light">
                  Climb Difficulty = <code>(Gradient/2)² * Length</code>. <br/>
                  Weighted by position: Climbs within the final 75km receive progressive multipliers (up to 100% value in final 10km).
                </p>
              </div>
            </div>

            {/* Buttons for Export and Analysis */}
            <div className="flex justify-center pt-8 pb-12 gap-4 print:hidden">
               <button 
                  onClick={() => setFileData(null)}
                  className="px-8 py-3 bg-[#00B4FF] hover:bg-[#00B4FF]/80 text-black font-bold uppercase tracking-widest rounded-sm text-sm transition-colors shadow-lg hover:shadow-[#00B4FF]/40 flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" /> New Analysis
               </button>
            </div>
            
          </div>
        )}
      </div>
    </div>
  );
};

// Component for displaying key statistics
const StatCard = ({ title, value, icon, highlight }) => (
  <div className={`
    p-6 rounded-sm border flex flex-col justify-between relative overflow-hidden group
    ${highlight ? 'bg-[#3b0687] border-[#00B4FF]/50' : 'bg-[#481a95] border-[#5e31a9]'}
  `}>
    {highlight && <div className="absolute top-0 right-0 w-16 h-16 bg-[#00B4FF]/5 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-150"></div>}
    <div className="flex justify-between items-start mb-4 relative z-10">
      <span className={`text-xs font-bold uppercase tracking-widest font-oswald ${highlight ? 'text-[#00B4FF]' : 'text-neutral-400'}`}>{title}</span>
      {icon}
    </div>
    <div className={`text-3xl md:text-4xl font-bold font-oswald tracking-tight relative z-10 ${highlight ? 'text-white' : 'text-neutral-100'}`}>
      {value}
    </div>
  </div>
);

// Custom SVG Chart for zero-dependency rendering of the elevation profile
const ElevationChart = ({ points, climbs, totalDistance, minEle, maxEle }) => {
  const displayPoints = useMemo(() => {
    if (points.length < 500) return points;
    const factor = Math.floor(points.length / 500);
    return points.filter((_, i) => i % factor === 0);
  }, [points]);

  const height = 250;
  const width = 800; 
  const padding = 20;

  const safeTotalDistance = totalDistance > 0 ? totalDistance : 1;
  const safeEleRange = maxEle - minEle > 0 ? maxEle - minEle : 1;

  const getX = (dist) => padding + (dist / safeTotalDistance) * (width - padding * 2);
  const getY = (ele) => height - padding - ((ele - minEle) / safeEleRange * (height - padding * 2));

  const pathD = displayPoints.map((p, i) => 
    `${i === 0 ? 'M' : 'L'} ${getX(p.dist)} ${getY(p.ele)}`
  ).join(' ');

  const fillD = `
    ${pathD} 
    L ${getX(displayPoints[displayPoints.length-1]?.dist || 0)} ${height - padding} 
    L ${getX(0)} ${height - padding} 
    Z
  `;
  
  const climbPaths = useMemo(() => {
    return climbs.map(climb => {
      const climbPoints = points.filter(p => p.dist >= climb.startDist && p.dist <= climb.endDist);
      const step = Math.max(1, Math.floor(climbPoints.length / 20));
      const pts = climbPoints.filter((_, idx) => idx % step === 0);
      
      if (pts.length < 2) return null;

      const topPath = pts.map((p, idx) => 
          `${idx === 0 ? 'M' : 'L'} ${getX(p.dist)} ${getY(p.ele)}`
      ).join(' ');

      const fillD = `
          M ${getX(climb.startDist)} ${height - padding} 
          ${topPath.replace('M', 'L')} 
          L ${getX(climb.endDist)} ${height - padding} 
          Z
      `;
      
      const lineD = topPath;
      
      // Update Colors to match theme (Slightly more muted/matte)
      const color = climb.gradientAvg > 8 ? '#ef4444' : climb.gradientAvg > 5 ? '#f97316' : '#10b981';

      return { 
          fillD, 
          lineD, 
          color, 
          key: climb.startDist + climb.endDist 
      };
    }).filter(c => c !== null);
  }, [climbs, points, totalDistance, minEle, maxEle]); 

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full preserve-3d">
      <defs>
        <linearGradient id="gradient" x1="0" x2="0" y1="0" y2="1">
          {/* Updated gradient to use Bright Blue hint */}
          <stop offset="0%" stopColor="#00B4FF" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#00B4FF" stopOpacity="0.0"/>
        </linearGradient>
      </defs>
      
      {/* Grid Lines - Darker Purple */}
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#52259c" strokeWidth="1" />
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#52259c" strokeWidth="1" />

      <path d={fillD} fill="url(#gradient)" opacity="0.6" />
      
      {climbPaths.map((c, i) => (
          <path 
              key={`fill-${c.key}`} 
              d={c.fillD} 
              fill={c.color} 
              opacity="0.4" 
              stroke="none" 
          />
      ))}
      
      {/* Main Line - White for high contrast on dark bg */}
      <path 
          d={pathD} 
          stroke="#ccc" 
          strokeWidth="1.5" 
          fill="none" 
          strokeLinecap="round" 
          strokeLinejoin="round" 
      />

      {climbPaths.map((c, i) => (
          <path 
              key={`line-${c.key}`} 
              d={c.lineD} 
              stroke={c.color} 
              strokeWidth="3" 
              fill="none" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
          />
      ))}

      <text x={padding} y={height} fill="#ccc" fontSize="10" dy="-5" fontFamily="Roboto">0km</text>
      <text x={width-padding} y={height} fill="#ccc" fontSize="10" textAnchor="end" dy="-5" fontFamily="Roboto">{totalDistance.toFixed(0)}km</text>
    </svg>
  );
};

export default App;
