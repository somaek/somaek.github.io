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
  
  // State for Road Book Fields
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

    // Calculate the new total distance of the course
    const totalDistance = baseData.distance * laps;

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

    // Pass the calculated total distance
    analyzeRoute(fullPoints, totalDistance);
  // Re-run whenever baseData or laps changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // Safely extract elevation, default to 0 if tag is missing
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

      // Smooth elevation data to reduce noise
      const smoothedPoints = smoothElevation(pointsWithDist, 3);
      
      // Reset controls and data upon successful upload
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
    // Only process .gpx files
    if (file.name.split('.').pop().toLowerCase() !== 'gpx') {
        console.error("Please upload a valid .gpx file.");
        setIsProcessing(false);
        return;
    }

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
        // Ensure index is valid before updating
        if (index >= 0 && index < newClimbs.length) {
          newClimbs[index] = { ...newClimbs[index], name: value };
        }
        return { ...prev, climbs: newClimbs };
    });
  };

  const analyzeRoute = (points, totalDistance) => {
    const CHUNK_SIZE = 0.2; // Analyze route in 200m chunks 
    let chunks = [];
    
    // 1. Break route into distance chunks to calculate local gradient
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
        // Gradient = (Elevation Change / Distance in meters) * 100
        const gradient = (gain / (dist * 1000)) * 100; 
        chunks.push({ startDist: start.dist, endDist: end.dist, gradient, gain, startEle: start.ele, endEle: end.ele });
        i = j - 1; // Move the index to the end of the analyzed chunk
      }
    }

    // 2. Aggregate chunks into continuous climbs
    let climbs = [];
    let currentClimb = null;

    chunks.forEach((chunk) => {
      const isUphill = chunk.gradient > 1.5; // Threshold for considering it an uphill segment

      if (isUphill) {
        if (!currentClimb) {
          // Start of a new climb
          currentClimb = {
            startDist: chunk.startDist,
            endDist: chunk.endDist,
            gain: chunk.gain,
            chunks: [chunk]
          };
        } else {
          // Continuation of the current climb
          currentClimb.endDist = chunk.endDist;
          currentClimb.gain += chunk.gain;
          currentClimb.chunks.push(chunk);
        }
      } else {
        if (currentClimb) {
           // End of the climb, if it exists
           climbs.push(currentClimb);
           currentClimb = null;
        }
      }
    });
    // Push the last climb if the route ends on an uphill
    if (currentClimb) climbs.push(currentClimb);

    // 3. Filter, score, and finalize climb data
    const validClimbs = climbs.filter(c => c.gain > 20).map((c, index) => { // Only count climbs with > 20m gain
      const lengthKm = c.endDist - c.startDist;
      // Safety check for lengthKm to avoid division by zero
      const gradientAvg = lengthKm > 0 ? (c.gain / (lengthKm * 1000)) * 100 : 0;
      const maxGradient = Math.max(...c.chunks.map(chunk => chunk.gradient));
      
      // Raw Score: (Avg Gradient / 2)^2 * Length (used the classic formula for simplicity)
      const rawScore = Math.pow(gradientAvg / 2, 2) * lengthKm; 

      // Apply positional multiplier based on distance to finish
      const distFromFinish = totalDistance - c.endDist; 
      let multiplier = 0.2;
      
      if (distFromFinish <= 10) multiplier = 1.0;
      else if (distFromFinish <= 25) multiplier = 0.8;
      else if (distFromFinish <= 50) multiplier = 0.6;
      else if (distFromFinish <= 75) multiplier = 0.4;

      return {
        ...c,
        id: index + 1, // Add the 1-based index as the climb ID
        name: '', // User will input this
        lengthKm,
        gradientAvg,
        maxGradient,
        rawScore,
        multiplier,
        finalScore: rawScore * multiplier,
        distFromFinish
      };
    }).sort((a, b) => a.startDist - b.startDist); // Sort by appearance on the course

    // Calculate overall statistics
    const totalScore = validClimbs.reduce((acc, c) => acc + c.finalScore, 0);
    const finalZoneStart = totalDistance - 25;
    const finalClimbs = validClimbs.filter(c => c.endDist >= finalZoneStart);
    const finalProfileScore = finalClimbs.reduce((acc, c) => acc + c.finalScore, 0);

    let totalClimbing = 0;
    for (let i = 1; i < points.length; i++) {
        const elevationChange = points[i].ele - points[i - 1].ele;
        if (elevationChange > 0) {
            // Only accumulate positive elevation change (gain)
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
    // THEME: Deep Purple (#3b0687) background and Bright Blue (#00B4FF) accents.
    <div className="min-h-screen bg-[#3b0687] text-white font-sans selection:bg-[#00B4FF] selection:text-black p-4 md:p-8">
      {/* Load External Fonts for aesthetic */}
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Roboto:wght@300;400;500;700&display=swap');
          
          h1, h2, h3, h4, .font-oswald {
            font-family: 'Oswald', sans-serif;
          }
          body, p, input, textarea, td, th {
            font-family: 'Roboto', sans-serif;
          }

          /* Print styles for road book export */
          @media print {
            .print\:hidden {
              display: none !important;
            }
            body {
              background-color: white !important;
            }
            .print\:text-black {
              color: black !important;
            }
            .print\:bg-white {
              background-color: white !important;
            }
            .print\:border-black {
              border-color: black !important;
            }
            /* Ensure text contrast for printing tables/inputs */
            .bg-[#481a95], .bg-[#3b0687] {
                background-color: #f0f0f0 !important;
            }
            table, th, td {
                color: black !important;
            }
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
                // Fallback for image loading issues
                onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = "https://placehold.co/1200x200/52259c/FFFFFF?text=Allkin+Classics+Profile+Tool";
                }}
            />
        </div>

        {/* Header (Text and Info) */}
        <header className="flex items-center space-x-4 border-b border-[#52259c] pb-6 print:hidden">
          <Activity className="w-8 h-8 text-[#00B4FF]" />
          <div>
            <h1 className="text-3xl font-bold tracking-wide uppercase text-white font-oswald">Allkin Classics Road Book</h1>
            <p className="text-neutral-300 text-sm tracking-wide">Race Profile Analyzer for GPX Files</p>
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
                <h3 className="text-2xl font-bold uppercase text-white font-oswald tracking-wide">Upload GPX Route File</h3>
                <p className="text-neutral-400 mt-2 font-light">Drag & drop a .gpx file here to begin analysis</p>
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
                    <label htmlFor="race-title" className="block text-xs font-bold text-[#00B4FF] uppercase tracking-widest mb-2">Race Title</label>
                    <input 
                        id="race-title"
                        type="text" 
                        value={raceTitle}
                        onChange={(e) => setRaceTitle(e.target.value)}
                        className="w-full bg-[#3b0687] border border-[#5e31a9] rounded-none px-4 py-3 text-3xl font-bold text-white uppercase font-oswald focus:outline-none focus:border-[#00B4FF] focus:ring-1 focus:ring-[#00B4FF] transition-all placeholder-neutral-500 print:text-black print:bg-white print:border-black"
                        placeholder="ENTER RACE NAME..."
                    />
                </div>
                <div>
                    <label htmlFor="race-desc" className="block text-xs font-bold text-[#00B4FF] uppercase tracking-widest mb-2">Description / Notes</label>
                    <textarea 
                        id="race-desc"
                        value={raceDescription}
                        onChange={(e) => setRaceDescription(e.target.value)}
                        className="w-full bg-[#3b0687] border border-[#5e31a9] rounded-none px-4 py-3 text-neutral-200 focus:outline-none focus:border-[#00B4FF] focus:ring-1 focus:ring-[#00B4FF] h-24 resize-none transition-all placeholder-neutral-500 print:text-black print:bg-white print:border-black"
                        placeholder="Add race details, start time, or key segments..."
                    />
                </div>
            </div>

            {/* Controls Bar (Laps) */}
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
                      aria-label="Decrease laps"
                    >-</button>
                    <div className="w-12 text-center font-oswald font-bold text-xl text-[#00B4FF]">{laps}</div>
                    <button 
                      onClick={() => setLaps(laps + 1)} 
                      className="px-4 py-1 text-neutral-400 hover:text-white hover:bg-[#52259c] rounded-sm transition-colors font-bold"
                      aria-label="Increase laps"
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
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-neutral-400 bg-[#3b0687] uppercase text-xs font-bold tracking-wider font-oswald">
                    <tr>
                      <th className="px-6 py-4 w-10 border-b border-[#5e31a9]">No.</th>
                      <th className="px-6 py-4 w-64 border-b border-[#5e31a9]">Climb Name</th>
                      <th className="px-6 py-4 border-b border-[#5e31a9]">Location (km)</th>
                      <th className="px-6 py-4 border-b border-[#5e31a9]">Length</th>
                      <th className="px-6 py-4 border-b border-[#5e31a9]">Avg %</th>
                      <th className="px-6 py-4 border-b border-[#5e31a9]">Max %</th>
                      <th className="px-6 py-4 border-b border-[#5e31a9]">Score</th>
                      <th className="px-6 py-4 border-b border-[#5e31a9] text-right">To Finish</th>
                    </tr>
                  </thead>
                  {/* FIX: Explicitly wrap all content rows in <tbody> to prevent DOM nesting warnings */}
                  <tbody className="divide-y divide-[#5e31a9] print:bg-white print:divide-black/20">
                    {fileData.climbs.length === 0 ? (
                      <tr><td colSpan="8" className="p-8 text-center text-neutral-500 italic print:text-black">No significant climbs detected.</td></tr>
                    ) : (
                      fileData.climbs.map((climb, idx) => (
                        <tr key={idx} className="hover:bg-[#52259c] transition-colors group print:text-black">
                          <td className="px-6 py-3 font-bold text-[#00B4FF] font-oswald print:text-black">
                            {climb.id}
                          </td>
                          <td className="px-6 py-3">
                              <input 
                                  type="text"
                                  placeholder="NAME..."
                                  value={climb.name}
                                  onChange={(e) => updateClimbName(idx, e.target.value)}
                                  className="bg-[#3b0687] border border-[#5e31a9] rounded-none px-3 py-1 text-white w-full focus:border-[#00B4FF] focus:outline-none focus:ring-1 focus:ring-[#00B4FF] placeholder-neutral-500 uppercase font-bold text-sm print:text-black print:bg-white print:border-black transition-all"
                              />
                          </td>
                          <td className="px-6 py-4 font-mono text-neutral-300 print:text-black">
                            {climb.startDist.toFixed(1)} <span className="text-neutral-500 mx-1 print:text-black/50">/</span> {climb.endDist.toFixed(1)}
                          </td>
                          <td className="px-6 py-4 text-white font-medium print:text-black">{climb.lengthKm.toFixed(2)} km</td>
                          {/* Avg Grade */}
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 text-xs font-bold uppercase tracking-wide ${
                              climb.gradientAvg > 8 ? 'text-red-400 print:text-red-700' : 
                              climb.gradientAvg > 5 ? 'text-orange-400 print:text-orange-700' : 'text-lime-400 print:text-green-700'
                            }`}>
                              {climb.gradientAvg.toFixed(1)}%
                            </span>
                          </td>
                          {/* Max Grade */}
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 text-xs font-bold uppercase tracking-wide rounded ${
                              climb.maxGradient > 12 ? 'bg-red-900/30 text-red-400 print:bg-red-100 print:text-red-700' : 
                              climb.maxGradient > 8 ? 'bg-orange-900/30 text-orange-400 print:bg-orange-100 print:text-orange-700' : 'bg-lime-900/30 text-lime-400 print:bg-green-100 print:text-green-700'
                            }`}>
                              {climb.maxGradient.toFixed(1)}%
                            </span>
                          </td>
                          {/* Difficulty (Raw Score) */}
                          <td className="px-6 py-4 text-neutral-200 font-mono print:text-black">{Math.round(climb.rawScore)}</td>
                          {/* To Finish */}
                          <td className="px-6 py-4 text-right text-white font-bold print:text-black">{climb.distFromFinish.toFixed(1)} km</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Methodology Note - Updated */}
            <div className="bg-[#481a95] border border-[#5e31a9] rounded-sm p-5 flex gap-4 text-sm text-neutral-300 items-start print:bg-white print:border-black print:text-black">
              <Info className="w-5 h-5 shrink-0 text-[#00B4FF] mt-0.5 print:text-black" />
              <div>
                <p className="font-bold uppercase text-white font-oswald mb-1 print:text-black">Scoring Methodology</p>
                <p className="opacity-80 leading-relaxed font-light print:opacity-100">
                  Climb Difficulty = <code>(Gradient/2)² * Length (km)</code>. <br/>
                  Weighted by position: Climbs within the final 75km receive progressive multipliers (up to 100% value in final 10km).
                </p>
              </div>
            </div>

            {/* Buttons for Export and Analysis - Print button removed */}
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
    print:bg-white print:border-black print:text-black
  `}>
    {/* Animated Corner accent */}
    {highlight && <div className="absolute top-0 right-0 w-16 h-16 bg-[#00B4FF]/5 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-150 print:hidden"></div>}
    
    <div className="flex justify-between items-start mb-4 relative z-10">
      <span className={`text-xs font-bold uppercase tracking-widest font-oswald ${highlight ? 'text-[#00B4FF] print:text-black' : 'text-neutral-400 print:text-black/70'}`}>{title}</span>
      {React.cloneElement(icon, { className: icon.props.className.replace('text-neutral-300', 'print:text-black') })}
    </div>
    <div className={`text-3xl md:text-4xl font-bold font-oswald tracking-tight relative z-10 ${highlight ? 'text-white print:text-black' : 'text-neutral-100 print:text-black'}`}>
      {value}
    </div>
  </div>
);

// Custom SVG Chart for zero-dependency rendering of the elevation profile
const ElevationChart = ({ points, climbs, totalDistance, minEle, maxEle }) => {
  // Memoize displayed points to thin out massive datasets for performance
  const displayPoints = useMemo(() => {
    // If fewer than 500 points, use all of them
    if (points.length < 500) return points;
    // Otherwise, sample every Nth point to keep it manageable
    const factor = Math.floor(points.length / 500);
    return points.filter((_, i) => i % factor === 0);
  }, [points]);

  const height = 250;
  const width = 800; // Fixed internal SVG width
  
  // Use separate padding for vertical and horizontal axes
  const vPadding = 20; // Vertical padding for top/bottom labels
  const hPadding = 5;  // Reduced horizontal padding to hug the edges

  // Use safe values to prevent division by zero
  const safeTotalDistance = totalDistance > 0 ? totalDistance : 1;
  const safeEleRange = maxEle - minEle > 0 ? maxEle - minEle : 1;

  // Scaling functions
  const getX = (dist) => hPadding + (dist / safeTotalDistance) * (width - hPadding * 2);
  const getY = (ele) => height - vPadding - ((ele - minEle) / safeEleRange * (height - vPadding * 2));

  // Create the main path string for the elevation line
  const pathD = displayPoints.map((p, i) => 
    `${i === 0 ? 'M' : 'L'} ${getX(p.dist)} ${getY(p.ele)}`
  ).join(' ');

  // Create the path string for the area fill (closing the shape to the bottom)
  const fillD = `
    ${pathD} 
    L ${getX(displayPoints[displayPoints.length-1]?.dist || 0)} ${height - vPadding} 
    L ${getX(0)} ${height - vPadding} 
    Z
  `;
  
  // Memoize climb paths and coordinates for optimal rendering and numbering
  const climbData = useMemo(() => {
    return climbs.map((climb, index) => {
      const climbPoints = points.filter(p => p.dist >= climb.startDist && p.dist <= climb.endDist);
      
      // Calculate midpoint distance
      const midDist = climb.startDist + (climb.lengthKm / 2);
      
      // Find the point closest to the midpoint distance
      const midPoint = points.reduce((prev, curr) => 
          (Math.abs(curr.dist - midDist) < Math.abs(prev.dist - midDist) ? curr : prev), 
          points[0] // Fallback to first point if calculation fails
      );
      
      // Sample climb points for drawing the overlay
      const step = Math.max(1, Math.floor(climbPoints.length / 50)); 
      const pts = climbPoints.filter((_, idx) => idx % step === 0);
      
      if (pts.length < 2) return null;

      const topPath = pts.map((p, idx) => 
          `${idx === 0 ? 'M' : 'L'} ${getX(p.dist)} ${getY(p.ele)}`
      ).join(' ');

      const fillD = `
          M ${getX(climb.startDist)} ${height - vPadding} 
          ${topPath.replace('M', 'L')} 
          L ${getX(climb.endDist)} ${height - vPadding} 
          Z
      `;
      
      const lineD = topPath;
      
      // Color coding climbs based on average gradient
      const color = climb.gradientAvg > 8 ? '#ef4444' : climb.gradientAvg > 5 ? '#f97316' : '#10b981';
      
      // Updated Coordinates for placing the climb number (at the midpoint, higher up)
      const numberX = getX(midPoint.dist);
      const numberY = getY(midPoint.ele) - 25; // Increased offset to move higher

      return { 
          fillD, 
          lineD, 
          color, 
          id: climb.id,
          key: climb.startDist + climb.endDist,
          numberCoords: { x: numberX, y: numberY, ele: midPoint.ele }
      };
    }).filter(c => c !== null);
  }, [climbs, points, safeEleRange, safeTotalDistance, minEle, maxEle]); 

  // Calculate y-axis labels and horizontal grid lines
  const eleInterval = Math.ceil(safeEleRange / 4 / 10) * 10; // Round up to nearest 10 for grid lines
  const gridLines = useMemo(() => {
    const lines = [];
    if (eleInterval <= 0) return lines;
    
    for (let ele = minEle + eleInterval; ele < maxEle; ele += eleInterval) {
      lines.push({ ele, y: getY(ele) });
    }
    return lines;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minEle, maxEle, eleInterval]);

  // Calculate x-axis labels
  const distInterval = totalDistance / 5; // 5 major ticks
  const xLabels = useMemo(() => {
    const labels = [];
    for (let i = 1; i <= 4; i++) {
        const dist = distInterval * i;
        labels.push({ dist, x: getX(dist) });
    }
    return labels;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalDistance, distInterval]);
  

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full preserve-3d">
      <defs>
        <linearGradient id="gradient" x1="0" x2="0" y1="0" y2="1">
          {/* Main Area Gradient - Bright Blue hint */}
          <stop offset="0%" stopColor="#00B4FF" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#00B4FF" stopOpacity="0.0"/>
        </linearGradient>
      </defs>
      
      {/* Grid Lines - Darker Purple for background context */}
      {/* X-Axis and Y-Axis baselines */}
      <line x1={hPadding} y1={height - vPadding} x2={width - hPadding} y2={height - vPadding} stroke="#52259c" strokeWidth="1" />
      <line x1={hPadding} y1={vPadding} x2={hPadding} y2={height - vPadding} stroke="#52259c" strokeWidth="1" />

      {/* Horizontal Grid Lines */}
      {gridLines.map((line, i) => (
        <line 
          key={i} 
          x1={hPadding} 
          y1={line.y} 
          x2={width - hPadding} 
          y2={line.y} 
          stroke="#52259c" 
          strokeWidth="0.5" 
          strokeDasharray="4 4"
        />
      ))}
      
      {/* Vertical Grid Lines */}
      {xLabels.map((label, i) => (
        <line 
          key={`x-${i}`} 
          x1={label.x} 
          y1={vPadding} 
          x2={label.x} 
          y2={height - vPadding} 
          stroke="#52259c" 
          strokeWidth="0.5" 
          strokeDasharray="4 4"
        />
      ))}

      {/* Elevation Area Fill */}
      <path d={fillD} fill="url(#gradient)" opacity="0.6" className="print:hidden" />
      <path d={fillD} fill="none" stroke="#ccc" strokeWidth="0.5" className="hidden print:block" />
      
      {/* Climb Area Fills */}
      {climbData.map((c) => (
          <path 
              key={`fill-${c.key}`} 
              d={c.fillD} 
              fill={c.color} 
              opacity="0.4" 
              stroke="none" 
              className="print:opacity-20"
          />
      ))}
      
      {/* Main Elevation Line */}
      <path 
          d={pathD} 
          stroke="#ccc" 
          strokeWidth="1.5" 
          fill="none" 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          className="print:stroke-black print:stroke-1"
      />

      {/* Climb Highlight Lines (thicker lines on the uphill segments) */}
      {climbData.map((c) => (
          <path 
              key={`line-${c.key}`} 
              d={c.lineD} 
              stroke={c.color} 
              strokeWidth="3" 
              fill="none" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              className="print:stroke-[2px]"
          />
      ))}

      {/* NEW: Climb Numbers */}
      {climbData.map((c) => (
          <text
              key={`num-${c.id}`}
              x={c.numberCoords.x} 
              y={c.numberCoords.y} 
              fill={c.color}
              fontSize="12"
              fontWeight="bold"
              textAnchor="middle"
              fontFamily="Oswald"
              className="drop-shadow-[0_1.2px_1.2px_rgba(0,0,0,0.8)] print:fill-black"
          >
              {c.id}
          </text>
      ))}


      {/* X-Axis Labels (Distance) */}
      <text x={hPadding} y={height} fill="#ccc" fontSize="10" dy="-5" fontFamily="Roboto" className="print:fill-black">0km</text>
      <text x={width-hPadding} y={height} fill="#ccc" fontSize="10" textAnchor="end" dy="-5" fontFamily="Roboto" className="print:fill-black">{totalDistance.toFixed(0)}km</text>
      {xLabels.map((label, i) => (
         <text 
            key={`l-x-${i}`} 
            x={label.x} 
            y={height} 
            fill="#ccc" 
            fontSize="10" 
            textAnchor="middle" 
            dy="-5" 
            fontFamily="Roboto"
            className="print:fill-black"
         >
            {label.dist.toFixed(0)}km
         </text>
      ))}

      {/* Y-Axis Labels (Elevation) */}
      <text x={hPadding} y={vPadding} fill="#ccc" fontSize="10" textAnchor="end" dx="-5" fontFamily="Roboto" className="print:fill-black">{Math.round(maxEle)}m</text>
      <text x={hPadding} y={height - vPadding} fill="#ccc" fontSize="10" textAnchor="end" dx="-5" fontFamily="Roboto" className="print:fill-black">{Math.round(minEle)}m</text>
      {gridLines.map((line, i) => (
        <text 
          key={`l-y-${i}`} 
          x={hPadding} 
          y={line.y} 
          fill="#ccc" 
          fontSize="10" 
          textAnchor="end" 
          dy="3" 
          dx="-5" 
          fontFamily="Roboto"
          className="print:fill-black"
        >
          {Math.round(line.ele)}m
        </text>
      ))}

    </svg>
  );
};

export default App;
