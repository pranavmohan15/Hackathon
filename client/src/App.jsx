import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const CONFIG = {
  GOOGLE_MAPS_KEY: import.meta.env.VITE_GOOGLE_MAPS_KEY || "YOUR_GOOGLE_MAPS_API_KEY",
  GOOGLE_CLIENT_ID: import.meta.env.VITE_GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID",
  GEMINI_MODEL: "gemini-2.0-flash-latest",
  DEFAULT_CENTER: { lat: 9.9312, lng: 76.2673 },
  DEFAULT_ORIGIN: "Ernakulam, Kochi, Kerala",
  DEFAULT_DESTINATION: "Kakkanad, Kochi, Kerala",
  MAX_WAYPOINTS: 3,
  SEARCH_RADIUS: 3000,
};

const KERALA_BOUNDS = {
  north: 12.8,
  south: 8.0,
  east: 77.7,
  west: 74.5,
};

const SYSTEM_PROMPT = `You are SNA - a smart navigation assistant for Kerala, India.
You help users find nearby amenities while traveling.

Current route context will be provided in each message.
When a user asks for an amenity (petrol pump, toilet, restaurant, ATM, hospital, etc.):
- Acknowledge their request warmly
- Tell them you are searching nearby
- Respond with: AMENITY_SEARCH:{"type":"<place_type>","keyword":"<search_term>"}

place_type options: gas_station, restaurant, hospital, atm, convenience_store, lodging

Keep responses short (2-3 sentences max). Be conversational and friendly.
Use simple English. You serve everyday commuters in Kerala.`;

const AMENITY_EMOJI = {
  gas_station: "?",
  restaurant: "???",
  hospital: "??",
  atm: "??",
  convenience_store: "??",
  lodging: "???",
};

const exactIntentMatchers = {
  "wheres the nearest petrol pump": { kind: "amenity", search: { type: "gas_station", keyword: "petrol pump" } },
  "where is the nearest petrol pump": { kind: "amenity", search: { type: "gas_station", keyword: "petrol pump" } },
  "i need a toilet": { kind: "amenity", search: { type: "convenience_store", keyword: "toilet" } },
  "find me a restaurant": { kind: "amenity", search: { type: "restaurant", keyword: "restaurant" } },
  "is there an atm nearby": { kind: "amenity", search: { type: "atm", keyword: "atm" } },
  "i need a hospital": { kind: "amenity", search: { type: "hospital", keyword: "hospital" } },
  "whats my route": { kind: "route" },
  "what is my route": { kind: "route" },
};

const mapsScriptUrl =
  `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CONFIG.GOOGLE_MAPS_KEY)}&libraries=places&loading=async`;

function formatDuration(totalSeconds) {
  if (!totalSeconds || totalSeconds < 60) return "under 1 min";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (!hours) return `${minutes} min`;
  if (!minutes) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

function distanceBetween(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earth = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earth * c;
}

function nowTime() {
  return new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function getRouteContextString(route, userMessage) {
  return `[Route: ${route.origin} to ${route.destination}, ~${route.distance}, ~${route.duration}] User says: ${userMessage}`;
}

function detectExactIntent(message) {
  const normalized = message.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  return exactIntentMatchers[normalized] || null;
}

function parseAmenityDirective(botText) {
  const match = botText.match(/AMENITY_SEARCH:\s*(\{.*?\})/s);
  if (!match) return { displayText: botText, amenitySearch: null };

  let amenitySearch = null;
  try {
    amenitySearch = JSON.parse(match[1]);
  } catch {
    amenitySearch = null;
  }

  const displayText = botText.replace(match[0], "").trim() || "I am searching nearby options for you now.";
  return { displayText, amenitySearch };
}

function loadMapsScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.Map) {
      resolve();
      return;
    }

    const existing = document.querySelector("script[data-sna-maps='1']");
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("maps_load_failed")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.dataset.snaMaps = "1";
    script.src = mapsScriptUrl;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("maps_load_failed"));
    document.body.appendChild(script);
  });
}

export default function App() {
  const mapNodeRef = useRef(null);
  const chatHistoryRef = useRef(null);

  const mapRef = useRef(null);
  const infoWindowRef = useRef(null);
  const directionsServiceRef = useRef(null);
  const directionsRendererRef = useRef(null);
  const placesServiceRef = useRef(null);
  const fromAutocompleteRef = useRef(null);
  const toAutocompleteRef = useRef(null);
  const recognitionRef = useRef(null);
  const voicesRef = useRef([]);
  const lastDirectionsRef = useRef(null);
  const markerByPlaceIdRef = useRef(new Map());
  const touchStartYRef = useRef(null);
  const greetingGivenRef = useRef(false);

  const [fromValue, setFromValue] = useState(localStorage.getItem("sna_home") || CONFIG.DEFAULT_ORIGIN);
  const [toValue, setToValue] = useState(localStorage.getItem("sna_college") || CONFIG.DEFAULT_DESTINATION);
  const [routeSummary, setRouteSummary] = useState({
    origin: localStorage.getItem("sna_home") || CONFIG.DEFAULT_ORIGIN,
    destination: localStorage.getItem("sna_college") || CONFIG.DEFAULT_DESTINATION,
    distance: "unknown distance",
    duration: "unknown time",
  });

  const [distanceDisplay, setDistanceDisplay] = useState("Calculating distance...");
  const [durationDisplay, setDurationDisplay] = useState("Calculating time...");
  const [locationStatus, setLocationStatus] = useState("?? Using route midpoint");
  const [saveStatus, setSaveStatus] = useState("");
  const [routeLoading, setRouteLoading] = useState(false);
  const [mapLoading, setMapLoading] = useState(true);

  const [waypointStops, setWaypointStops] = useState([]);
  const [userPosition, setUserPosition] = useState(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const [amenitySearching, setAmenitySearching] = useState(false);

  const [listening, setListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState("Tap mic, speak, then confirm text before sending.");
  const [speaking, setSpeaking] = useState(false);

  const canLoadMaps = useMemo(
    () => CONFIG.GOOGLE_MAPS_KEY && CONFIG.GOOGLE_MAPS_KEY !== "YOUR_GOOGLE_MAPS_API_KEY",
    []
  );

  const appendMessage = (role, text) => {
    setChatMessages((prev) => [...prev, { id: `${Date.now()}_${Math.random()}`, role, text, time: nowTime() }]);
  };

  const speakText = (text) => {
    if (!window.speechSynthesis || !text) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;

    const voices = voicesRef.current.length ? voicesRef.current : window.speechSynthesis.getVoices();
    const indian = voices.find((voice) => (voice.lang || "").toLowerCase().startsWith("en-in"));
    const us = voices.find((voice) => (voice.lang || "").toLowerCase().startsWith("en-us"));
    if (indian || us) utterance.voice = indian || us;

    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const getRouteMidpoint = () => {
    const path = lastDirectionsRef.current?.routes?.[0]?.overview_path || [];
    if (path.length) return path[Math.floor(path.length / 2)];
    return mapRef.current?.getCenter() || new window.google.maps.LatLng(CONFIG.DEFAULT_CENTER.lat, CONFIG.DEFAULT_CENTER.lng);
  };

  const calculateRoute = async (customStops = waypointStops, customFrom = fromValue, customTo = toValue) => {
    if (!directionsServiceRef.current || !customFrom.trim() || !customTo.trim()) return false;

    setRouteLoading(true);

    const waypoints = customStops.map((stop) => ({
      location: stop.location,
      stopover: true,
    }));

    const success = await new Promise((resolve) => {
      directionsServiceRef.current.route(
        {
          origin: customFrom,
          destination: customTo,
          waypoints,
          optimizeWaypoints: false,
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === "OK") {
            lastDirectionsRef.current = result;
            directionsRendererRef.current.setDirections(result);

            const legs = result.routes[0].legs || [];
            let totalMeters = 0;
            let totalSeconds = 0;

            legs.forEach((leg) => {
              totalMeters += (leg.distance && leg.distance.value) || 0;
              totalSeconds += (leg.duration && leg.duration.value) || 0;
            });

            const distanceText = totalMeters ? `${(totalMeters / 1000).toFixed(1)} km` : "0 km";
            const durationText = formatDuration(totalSeconds);

            setDistanceDisplay(`Distance: ${distanceText}`);
            setDurationDisplay(`ETA: ${durationText}`);
            setRouteSummary({
              origin: customFrom,
              destination: customTo,
              distance: distanceText,
              duration: durationText,
            });
            resolve(true);
            return;
          }

          setDistanceDisplay("Route unavailable");
          setDurationDisplay("Please adjust locations");
          setRouteSummary({
            origin: customFrom,
            destination: customTo,
            distance: "unknown distance",
            duration: "unknown time",
          });
          resolve(false);
        }
      );
    });

    setRouteLoading(false);
    return success;
  };

  const fetchAssistantReply = async (userMessage) => {
    if (!navigator.onLine) throw new Error("offline");

    const routeContext = getRouteContextString(routeSummary, userMessage);
    const cacheKey = `sna_cache_${routeContext}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return cached;

    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeContext,
        systemPrompt: SYSTEM_PROMPT,
        model: CONFIG.GEMINI_MODEL,
      }),
    });

    if (!res.ok) {
      throw new Error("api");
    }

    const data = await res.json();
    const text = data?.text?.trim() || "I am checking nearby options for you.";
    sessionStorage.setItem(cacheKey, text);
    return text;
  };

  const runAmenitySearch = async (searchSpec) => {
    if (!placesServiceRef.current || !searchSpec?.type) return;

    if (waypointStops.length >= CONFIG.MAX_WAYPOINTS) {
      const msg = "You already have 3 stops. Remove one first?";
      appendMessage("bot", msg);
      speakText(msg);
      return;
    }

    setAmenitySearching(true);

    const center = userPosition
      ? new window.google.maps.LatLng(userPosition.lat, userPosition.lng)
      : getRouteMidpoint();

    const places = await new Promise((resolve) => {
      placesServiceRef.current.nearbySearch(
        {
          location: center,
          radius: CONFIG.SEARCH_RADIUS,
          type: searchSpec.type,
          keyword: searchSpec.keyword || undefined,
        },
        (results, status) => {
          if (status === window.google.maps.places.PlacesServiceStatus.OK && results?.length) {
            resolve(results);
            return;
          }
          resolve([]);
        }
      );
    });

    setAmenitySearching(false);

    if (!places.length) {
      const msg = "Sorry, couldn't find any nearby match. Try expanding the search area?";
      appendMessage("bot", msg);
      speakText(msg);
      return;
    }

    const sorted = places
      .filter((place) => place.geometry?.location)
      .map((place) => ({
        place,
        km: distanceBetween(center.lat(), center.lng(), place.geometry.location.lat(), place.geometry.location.lng()),
      }))
      .sort((a, b) => a.km - b.km);

    const selected = sorted[0];
    if (!selected) return;

    if (waypointStops.some((stop) => stop.placeId === selected.place.place_id)) {
      const msg = `${selected.place.name} is already in your stops.`;
      appendMessage("bot", msg);
      speakText(msg);
      return;
    }

    const emoji = AMENITY_EMOJI[searchSpec.type] || "??";
    const position = {
      lat: selected.place.geometry.location.lat(),
      lng: selected.place.geometry.location.lng(),
    };

    const ratingText = typeof selected.place.rating === "number" ? selected.place.rating.toFixed(1) : "N/A";
    const address = selected.place.vicinity || selected.place.formatted_address || "Address unavailable";

    const marker = new window.google.maps.Marker({
      map: mapRef.current,
      position,
      title: selected.place.name,
      label: { text: emoji, fontSize: "18px" },
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 12,
        fillColor: "#FF8F00",
        fillOpacity: 0.95,
        strokeColor: "#FFFFFF",
        strokeWeight: 2,
      },
    });

    marker.addListener("click", () => {
      const anchor = userPosition
        ? { lat: userPosition.lat, lng: userPosition.lng }
        : { lat: getRouteMidpoint().lat(), lng: getRouteMidpoint().lng() };
      const dKm = distanceBetween(anchor.lat, anchor.lng, position.lat, position.lng);

      infoWindowRef.current.setContent(`
        <div style="max-width:220px;font-family:system-ui,sans-serif;">
          <p style="margin:0 0 4px;font-weight:700;">${emoji} ${selected.place.name}</p>
          <p style="margin:0 0 4px;font-size:12px;">? ${ratingText}</p>
          <p style="margin:0 0 4px;font-size:12px;">${address}</p>
          <p style="margin:0;font-size:12px;">Distance: ${dKm.toFixed(1)} km</p>
        </div>
      `);
      infoWindowRef.current.open(mapRef.current, marker);
    });

    markerByPlaceIdRef.current.set(selected.place.place_id, marker);

    const nextStop = {
      placeId: selected.place.place_id,
      name: selected.place.name,
      location: position,
      emoji,
      ratingText,
      address,
      distanceKm: selected.km,
    };

    const nextStops = [...waypointStops, nextStop];
    setWaypointStops(nextStops);

    const routeOk = await calculateRoute(nextStops);

    if (!routeOk) {
      marker.setMap(null);
      markerByPlaceIdRef.current.delete(nextStop.placeId);
      setWaypointStops((prev) => prev.filter((stop) => stop.placeId !== nextStop.placeId));
      const msg = "I found a place, but could not add it to your route right now.";
      appendMessage("bot", msg);
      speakText(msg);
      return;
    }

    const legs = lastDirectionsRef.current?.routes?.[0]?.legs || [];
    let totalSeconds = 0;
    for (let i = 0; i <= nextStops.length - 1 && i < legs.length; i += 1) {
      totalSeconds += (legs[i].duration && legs[i].duration.value) || 0;
    }

    const eta = formatDuration(totalSeconds);
    const confirmText = `Found ${nextStop.name} just ${nextStop.distanceKm.toFixed(
      1
    )} km away. I've added it to your route. You'll arrive there in about ${eta}.`;

    appendMessage("bot", confirmText);
    appendMessage("bot", `Amenity Added: ${nextStop.emoji} ${nextStop.name} | ? ${nextStop.ratingText} | ${nextStop.address}`);
    speakText(confirmText);
  };

  const sendCurrentMessage = async () => {
    const userMessage = chatInput.trim();
    if (!userMessage) return;

    appendMessage("user", userMessage);
    setChatInput("");
    setTyping(true);

    try {
      const localIntent = detectExactIntent(userMessage);

      if (localIntent?.kind === "route") {
        setTyping(false);
        const routeText = `Current route is ${routeSummary.origin} to ${routeSummary.destination}. Distance is about ${routeSummary.distance} and travel time is about ${routeSummary.duration}.`;
        appendMessage("bot", routeText);
        speakText(routeText);
        return;
      }

      let rawReply = "";
      if (localIntent?.kind === "amenity") {
        rawReply = `Sure, I am searching nearby now. AMENITY_SEARCH:${JSON.stringify(localIntent.search)}`;
      } else {
        rawReply = await fetchAssistantReply(userMessage);
      }

      setTyping(false);

      const parsed = parseAmenityDirective(rawReply);
      if (parsed.displayText) {
        appendMessage("bot", parsed.displayText);
        speakText(parsed.displayText);
      }

      if (parsed.amenitySearch) {
        await runAmenitySearch(parsed.amenitySearch);
      }
    } catch (error) {
      setTyping(false);
      const msg = error.message === "offline" ? "You seem to be offline. Check your connection." : "Oops, something went wrong. Try again?";
      appendMessage("bot", msg);
      speakText(msg);
    }
  };

  const removeStop = async (index) => {
    const target = waypointStops[index];
    if (!target) return;

    const marker = markerByPlaceIdRef.current.get(target.placeId);
    if (marker) marker.setMap(null);
    markerByPlaceIdRef.current.delete(target.placeId);

    const nextStops = waypointStops.filter((_, idx) => idx !== index);
    setWaypointStops(nextStops);
    await calculateRoute(nextStops);

    const msg = `Removed stop: ${target.name}. Route updated.`;
    appendMessage("bot", msg);
    speakText(msg);
  };

  const openChat = () => {
    setChatOpen(true);
    if (!greetingGivenRef.current) {
      greetingGivenRef.current = true;
      appendMessage(
        "bot",
        "Hi! I'm your navigation assistant. Ask me about petrol pumps, restaurants, or anything on your route!"
      );
    }
  };

  const closeChat = () => {
    setChatOpen(false);
  };

  const initVoiceInput = () => {
    if (recognitionRef.current) return true;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceHint("Your browser doesn't support voice. You can type instead.");
      return false;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      setListening(true);
      setVoiceHint("Listening... speak naturally in Indian English.");
    };

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setChatInput(transcript.trim());
      setVoiceHint("Transcription ready. Edit if needed, then press Send.");
    };

    recognition.onerror = () => {
      setListening(false);
      const msg = "Sorry, couldn't hear that. Please try again.";
      appendMessage("bot", msg);
      speakText(msg);
      setVoiceHint("Mic error. Tap again to retry.");
    };

    recognition.onend = () => {
      setListening(false);
      if (chatInput.trim()) {
        setVoiceHint("Transcription ready. Edit if needed, then press Send.");
      }
    };

    recognitionRef.current = recognition;
    return true;
  };

  const toggleListening = () => {
    const ok = initVoiceInput();
    if (!ok) return;

    if (listening) {
      recognitionRef.current.stop();
      return;
    }

    setChatInput("");
    recognitionRef.current.start();
  };

  useEffect(() => {
    const history = chatHistoryRef.current;
    if (!history) return;
    history.scrollTop = history.scrollHeight;
  }, [chatMessages, typing]);

  useEffect(() => {
    let active = true;

    if (!canLoadMaps) {
      setMapLoading(false);
      setDistanceDisplay("Add Google Maps API key in .env");
      setDurationDisplay("Map unavailable");
      return () => {
        active = false;
      };
    }

    loadMapsScript()
      .then(() => {
        if (!active || !mapNodeRef.current) return;

        const map = new window.google.maps.Map(mapNodeRef.current, {
          center: CONFIG.DEFAULT_CENTER,
          zoom: 13,
          gestureHandling: "greedy",
        });

        mapRef.current = map;
        infoWindowRef.current = new window.google.maps.InfoWindow();
        directionsServiceRef.current = new window.google.maps.DirectionsService();
        directionsRendererRef.current = new window.google.maps.DirectionsRenderer({
          map,
          suppressMarkers: false,
          polylineOptions: {
            strokeColor: "#1565C0",
            strokeWeight: 5,
          },
        });
        placesServiceRef.current = new window.google.maps.places.PlacesService(map);

        const bounds = new window.google.maps.LatLngBounds(
          { lat: KERALA_BOUNDS.south, lng: KERALA_BOUNDS.west },
          { lat: KERALA_BOUNDS.north, lng: KERALA_BOUNDS.east }
        );

        fromAutocompleteRef.current = new window.google.maps.places.Autocomplete(document.getElementById("from-input"), {
          bounds,
          componentRestrictions: { country: "IN" },
          fields: ["formatted_address", "geometry"],
          strictBounds: false,
        });

        toAutocompleteRef.current = new window.google.maps.places.Autocomplete(document.getElementById("to-input"), {
          bounds,
          componentRestrictions: { country: "IN" },
          fields: ["formatted_address", "geometry"],
          strictBounds: false,
        });

        fromAutocompleteRef.current.addListener("place_changed", () => {
          const place = fromAutocompleteRef.current.getPlace();
          if (place?.formatted_address) setFromValue(place.formatted_address);
        });

        toAutocompleteRef.current.addListener("place_changed", () => {
          const place = toAutocompleteRef.current.getPlace();
          if (place?.formatted_address) setToValue(place.formatted_address);
        });

        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              setUserPosition({ lat: position.coords.latitude, lng: position.coords.longitude });
              setLocationStatus("?? Using your location");
            },
            () => {
              setUserPosition(null);
              setLocationStatus("?? Using route midpoint");
            },
            {
              enableHighAccuracy: true,
              timeout: 7000,
              maximumAge: 60000,
            }
          );
        }

        voicesRef.current = window.speechSynthesis?.getVoices?.() || [];
        if (window.speechSynthesis) {
          window.speechSynthesis.onvoiceschanged = () => {
            voicesRef.current = window.speechSynthesis.getVoices();
          };
        }

        calculateRoute([], fromValue, toValue).finally(() => {
          if (active) setMapLoading(false);
        });
      })
      .catch(() => {
        if (active) {
          setMapLoading(false);
          setDistanceDisplay("Route unavailable");
          setDurationDisplay("Please adjust locations");
        }
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    calculateRoute(waypointStops, fromValue, toValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromValue, toValue]);

  return (
    <div className="sna-root">
      <header className="sna-header">
        <div className="sna-brand">
          <span className="sna-logo">SNA</span>
          <span className="sna-title">Smart Navigation Assistant</span>
        </div>
        <div className="sna-avatar">AB</div>
      </header>

      <main className="sna-main">
        <section className="sna-card">
          <div className="sna-input-grid">
            <div>
              <label>From</label>
              <input id="from-input" value={fromValue} onChange={(event) => setFromValue(event.target.value)} autoComplete="off" />
            </div>

            <div>
              <label>To</label>
              <input id="to-input" value={toValue} onChange={(event) => setToValue(event.target.value)} autoComplete="off" />
            </div>

            <button
              onClick={() => {
                const nextFrom = toValue;
                const nextTo = fromValue;
                setFromValue(nextFrom);
                setToValue(nextTo);
              }}
            >
              Swap
            </button>
          </div>

          <div className="sna-actions">
            <button
              onClick={() => {
                localStorage.setItem("sna_home", fromValue.trim());
                setSaveStatus("Home saved");
                setTimeout(() => setSaveStatus(""), 2000);
              }}
            >
              Save as Home
            </button>
            <button
              onClick={() => {
                localStorage.setItem("sna_college", toValue.trim());
                setSaveStatus("College saved");
                setTimeout(() => setSaveStatus(""), 2000);
              }}
            >
              Save as College
            </button>
            <span>{saveStatus}</span>
          </div>

          <div className="sna-stops">
            <div className="sna-stops-header">
              <p>Stops</p>
              <p>{locationStatus}</p>
            </div>
            <div className="sna-stop-list">
              {!waypointStops.length ? (
                <span className="sna-muted">No stops added yet.</span>
              ) : (
                waypointStops.map((stop, index) => (
                  <div className="sna-stop-pill" key={stop.placeId}>
                    <span>
                      {stop.emoji} {stop.name}
                    </span>
                    <button onClick={() => removeStop(index)}>?</button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="sna-route-info">
            <span>{distanceDisplay}</span>
            <span>{durationDisplay}</span>
            {routeLoading ? <span className="sna-muted">Finding best route...</span> : null}
          </div>
        </section>

        <section className="sna-map-wrap">
          {mapLoading ? <div className="sna-map-loading">Loading map...</div> : null}
          <div id="map" ref={mapNodeRef} />
        </section>
      </main>

      {!chatOpen ? (
        <button className="sna-chat-bubble" onClick={openChat}>
          ???
        </button>
      ) : null}

      <section
        className={`sna-chat-panel ${chatOpen ? "open" : ""}`}
        onTouchStart={(event) => {
          touchStartYRef.current = event.touches[0].clientY;
        }}
        onTouchEnd={(event) => {
          const endY = event.changedTouches[0].clientY;
          if (touchStartYRef.current !== null && endY - touchStartYRef.current > 80) {
            closeChat();
          }
          touchStartYRef.current = null;
        }}
      >
        <div className="sna-chat-header">
          <div>
            <p>SNA Assistant</p>
            <small>Voice + AI Chat</small>
          </div>
          <div className="sna-chat-header-right">
            <span className={speaking ? "speaking" : ""}>{speaking ? "Speaking" : "Silent"}</span>
            <button onClick={closeChat}>—</button>
          </div>
        </div>

        <div className="sna-chat-history" ref={chatHistoryRef}>
          {chatMessages.map((message) => (
            <div key={message.id} className={`sna-msg-row ${message.role === "user" ? "user" : "bot"}`}>
              <div className={`sna-msg ${message.role === "user" ? "user" : "bot"}`}>
                <p>{message.text}</p>
                <small>{message.time}</small>
              </div>
            </div>
          ))}

          {typing ? (
            <div className="sna-msg-row bot">
              <div className="sna-msg bot typing">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>
          ) : null}
        </div>

        <div className="sna-chat-footer">
          {listening ? <div className="sna-muted">Listening...</div> : null}
          {amenitySearching ? <div className="sna-muted">Searching nearby...</div> : null}
          <div className="sna-chat-input-row">
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Ask for petrol pumps, restaurants, ATMs..."
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  sendCurrentMessage();
                }
              }}
            />
            <button onClick={toggleListening}>??</button>
            <button onClick={sendCurrentMessage}>?</button>
          </div>
          <p className="sna-muted">{voiceHint}</p>
        </div>
      </section>
    </div>
  );
}

