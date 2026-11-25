"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Papa from 'papaparse';
import { getCachedPassage, cachePassage } from '@/utils/indexedDB-daily';
import { FaBook, FaVolumeUp, FaGithub, FaHeart, FaSun, FaMoon, FaSearch, FaChevronDown, FaChevronUp, FaFilter, FaRegFileAlt, FaCommentAlt, FaSyncAlt, FaBackward, FaForward } from 'react-icons/fa';
import { Coffee } from 'lucide-react';
import { Analytics } from "@vercel/analytics/react";
import { track } from '@vercel/analytics';
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { CitedSummary } from "@/components/cited-summary";
import { Inter, Merriweather } from 'next/font/google';
import ReactMarkdown from 'react-markdown';
import { AppNav } from '@/components/navigation/app-nav';

const inter = Inter({ subsets: ['latin'] });
const merriweather = Merriweather({ weight: ['300', '400', '700'], subsets: ['latin'] });

function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Mapping of possible book abbreviations and variations to standardized book names
const BOOK_NAME_MAP = {
  // Old Testament
  'genesis': 'genesis', 'gen': 'genesis', 'gn': 'genesis',
  'exodus': 'exodus', 'exod': 'exodus', 'ex': 'exodus',
  'leviticus': 'leviticus', 'lev': 'leviticus', 'lv': 'leviticus',
  'numbers': 'numbers', 'num': 'numbers', 'nm': 'numbers', 'nu': 'numbers',
  'deuteronomy': 'deuteronomy', 'deut': 'deuteronomy', 'dt': 'deuteronomy',
  'joshua': 'joshua', 'josh': 'joshua', 'jos': 'joshua',
  'judges': 'judges', 'judg': 'judges', 'jgs': 'judges',
  'ruth': 'ruth', 'ru': 'ruth',
  '1 samuel': '1samuel', '1 sam': '1samuel', 'i samuel': '1samuel', '1 samuel': '1samuel',
  '2 samuel': '2samuel', '2 sam': '2samuel', 'ii samuel': '2samuel', '2 samuel': '2samuel',
  '1 kings': '1kings', '1 kgs': '1kings', 'i kings': '1kings',
  '2 kings': '2kings', '2 kgs': '2kings', 'ii kings': '2kings',
  '1 chronicles': '1chronicles', '1 chron': '1chronicles', '1 chr': '1chronicles', 'i chronicles': '1chronicles',
  '2 chronicles': '2chronicles', '2 chron': '2chronicles', '2 chr': '2chronicles', 'ii chronicles': '2chronicles',
  'ezra': 'ezra', 'ezr': 'ezra',
  'nehemiah': 'nehemiah', 'neh': 'nehemiah',
  'esther': 'esther', 'est': 'esther',
  'job': 'job', 'jb': 'job',
  'psalms': 'psalms', 'psalm': 'psalms', 'ps': 'psalms', 'psa': 'psalms',
  'proverbs': 'proverbs', 'prov': 'proverbs', 'prv': 'proverbs',
  'ecclesiastes': 'ecclesiastes', 'eccl': 'ecclesiastes', 'ecc': 'ecclesiastes',
  'song of solomon': 'songofsolomon', 'song of songs': 'songofsolomon', 'song': 'songofsolomon',
  'isaiah': 'isaiah', 'isa': 'isaiah',
  'jeremiah': 'jeremiah', 'jer': 'jeremiah',
  'lamentations': 'lamentations', 'lam': 'lamentations',
  'ezekiel': 'ezekiel', 'ezek': 'ezekiel', 'eze': 'ezekiel',
  'daniel': 'daniel', 'dan': 'daniel', 'dn': 'daniel',
  'hosea': 'hosea', 'hos': 'hosea',
  'joel': 'joel', 'jl': 'joel',
  'amos': 'amos', 'am': 'amos',
  'obadiah': 'obadiah', 'obad': 'obadiah', 'ob': 'obadiah',
  'jonah': 'jonah', 'jon': 'jonah',
  'micah': 'micah', 'mic': 'micah', 'mc': 'micah',
  'nahum': 'nahum', 'nah': 'nahum', 'na': 'nahum',
  'habakkuk': 'habakkuk', 'hab': 'habakkuk', 'hb': 'habakkuk',
  'zephaniah': 'zephaniah', 'zeph': 'zephaniah', 'zp': 'zephaniah',
  'haggai': 'haggai', 'hag': 'haggai', 'hg': 'haggai',
  'zechariah': 'zechariah', 'zech': 'zechariah', 'zc': 'zechariah',
  'malachi': 'malachi', 'mal': 'malachi', 'ml': 'malachi',
  
  // New Testament
  'matthew': 'matthew', 'matt': 'matthew', 'mt': 'matthew',
  'mark': 'mark', 'mrk': 'mark', 'mk': 'mark',
  'luke': 'luke', 'luk': 'luke', 'lk': 'luke',
  'john': 'john', 'jn': 'john',
  'acts': 'acts', 'ac': 'acts',
  'romans': 'romans', 'rom': 'romans', 'rm': 'romans',
  '1 corinthians': '1corinthians', '1 cor': '1corinthians', 'i corinthians': '1corinthians', '1 corinthians': '1corinthians',
  '2 corinthians': '2corinthians', '2 cor': '2corinthians', 'ii corinthians': '2corinthians', '2 corinthians': '2corinthians',
  'galatians': 'galatians', 'gal': 'galatians',
  'ephesians': 'ephesians', 'eph': 'ephesians',
  'philippians': 'philippians', 'phil': 'philippians', 'php': 'philippians',
  'colossians': 'colossians', 'col': 'colossians',
  '1 thessalonians': '1thessalonians', '1 thess': '1thessalonians', 'i thessalonians': '1thessalonians',
  '2 thessalonians': '2thessalonians', '2 thess': '2thessalonians', 'ii thessalonians': '2thessalonians',
  '1 timothy': '1timothy', '1 tim': '1timothy', 'i timothy': '1timothy',
  '2 timothy': '2timothy', '2 tim': '2timothy', 'ii timothy': '2timothy',
  'titus': 'titus',
  'philemon': 'philemon', 'philem': 'philemon', 'phm': 'philemon',
  'hebrews': 'hebrews', 'heb': 'hebrews',
  'james': 'james', 'jas': 'james', 'jm': 'james',
  '1 peter': '1peter', '1 pet': '1peter', 'i peter': '1peter',
  '2 peter': '2peter', '2 pet': '2peter', 'ii peter': '2peter',
  '1 john': '1john', 'i john': '1john',
  '2 john': '2john', 'ii john': '2john',
  '3 john': '3john', 'iii john': '3john',
  'jude': 'jude', 'jd': 'jude',
  'revelation': 'revelation', 'rev': 'revelation', 'rv': 'revelation',
};

// Function to normalize book names and map to standardized names
const normalizeBookName = (input) => {
  // Remove punctuation and make lowercase
  let normalized = input.replace(/[^\w\s]/gi, '').toLowerCase().trim();

  // Handle special cases for books with numbers
  normalized = normalized.replace(/^(1st|first)\s+/, '1 ');
  normalized = normalized.replace(/^(2nd|second)\s+/, '2 ');
  normalized = normalized.replace(/^(3rd|third)\s+/, '3 ');

  // Remove 'book of' prefix
  if (normalized.startsWith('book of ')) {
    normalized = normalized.replace('book of ', '');
  }

  // Trim extra whitespace
  normalized = normalized.trim();

  // Check if normalized book name is in the mapping
  if (BOOK_NAME_MAP[normalized]) {
    return BOOK_NAME_MAP[normalized];
  }

  // If no match found, return null
  return null;
};

// Function to parse a single passage string into book and chapter range
const parsePassageString = (passageStr) => {
  // Regex to match book names and chapter ranges
  const regex = /^(.+?)(\s+\d+(-\d+)?)$/; // e.g., 'Genesis 1-3', 'Ps 23'
  const match = passageStr.match(regex);
  if (match) {
    let bookName = match[1].trim();
    let chapterRangeStr = match[2].trim();

    let normalizedBookName = normalizeBookName(bookName);
    if (!normalizedBookName) {
      throw new Error(`Unrecognized book name: ${bookName}`);
    }
    return {
      book: normalizedBookName,
      chapterRangeStr
    };
  } else {
    //throw new Error(`Invalid passage format: ${passageStr}`);
  }
};

// Function to parse chapter ranges
const parseChapterRange = (rangeStr) => {
  const rangeMatch = rangeStr.match(/^(\d+)(-(\d+))?$/);
  if (rangeMatch) {
    const startChapter = parseInt(rangeMatch[1]);
    const endChapter = rangeMatch[3] ? parseInt(rangeMatch[3]) : startChapter;
    if (endChapter >= startChapter) {
      return Array.from({ length: endChapter - startChapter + 1 }, (_, i) => startChapter + i);
    }
  }
  throw new Error(`Invalid chapter range: ${rangeStr}`);
};

const MAX_TOKENS = 100000;
const RATE_LIMIT_DELAY = 1000; // 1 second delay between API calls

// Queue for managing API calls
const apiQueue = [];
let isProcessingQueue = false;

const processQueue = async () => {
  if (isProcessingQueue || apiQueue.length === 0) return;

  isProcessingQueue = true;
  const { key, commentaryData, resolve, reject } = apiQueue.shift();

  try {
    const response = await fetch('/api/summary', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        book: key.split('-')[0].toLowerCase(),
        chapter: parseInt(key.split('-')[1]),
        commentaryData,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch summary for ${key}`);
    }

    const data = await response.json();
    resolve(data.summary);
  } catch (error) {
    console.error(error);
    reject("Summary generation failed.");
  } finally {
    isProcessingQueue = false;
    setTimeout(processQueue, RATE_LIMIT_DELAY);
  }
};

export default function Home() {
  const [passage, setPassage] = useState('');
  const [weekNumber, setWeekNumber] = useState(1);
  const [dayNumber, setDayNumber] = useState(1);
  const [readings, setReadings] = useState([]);
  const [content, setContent] = useState('');
  const [error, setError] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const audioRef = useRef(null);
  const [cssLink, setCssLink] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  // AI Audio feature removed - not needed
  const [isMobile, setIsMobile] = useState(false);
  const [audioError, setAudioError] = useState(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  // AI Audio voices removed - not needed
  const [passageKey, setPassageKey] = useState(0);
  const abortControllerRef = useRef(null);

  const debouncedPassage = useDebounce(passage, 500);
  const sidebarRef = useRef(null);
  const toggleButtonRef = useRef(null);

  // Theme management
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') || 'light';
    }
    return 'light';
  });

  // New states for search functionality
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const debouncedSearchQuery = useDebounce(searchQuery, 500);

  const [showCommentary, setShowCommentary] = useState(false); // Default to false
  const [selectedFather, setSelectedFather] = useState('Augustine of Hippo');
  const [showSummaries, setShowSummaries] = useState(false);
  const [isCommentaryLoaded, setIsCommentaryLoaded] = useState(false);

  // Use useEffect to update state from localStorage after initial render
  useEffect(() => {
    const savedShowCommentary = localStorage.getItem('showCommentary');
    if (savedShowCommentary !== null) {
      setShowCommentary(savedShowCommentary === 'true');
    }

    const savedFather = localStorage.getItem('selectedFather');
    if (savedFather) {
      setSelectedFather(savedFather);
    }

    const savedShowSummaries = localStorage.getItem('showSummaries');
    if (savedShowSummaries !== null) {
      setShowSummaries(savedShowSummaries === 'true');
    }

    setIsCommentaryLoaded(true);
  }, []);

  const toggleCommentary = () => {
    const newValue = !showCommentary;
    setShowCommentary(newValue);
    localStorage.setItem('showCommentary', newValue);
  };

  const handleFatherChange = (e) => {
    const newFather = e.target.value;
    setSelectedFather(newFather);
    localStorage.setItem('selectedFather', newFather);
    setShowSummaries(false);
    localStorage.setItem('showSummaries', false);
    // Clear all summaries when changing the selected father
    setCommentaries(prevCommentaries => 
      prevCommentaries.map(item => ({
        ...item,
        summary: null,
        showSummary: false,
        summaryError: null
      }))
    );
  };

  const toggleSummaries = () => {
    const newValue = !showSummaries;
    setShowSummaries(newValue);
    localStorage.setItem('showSummaries', newValue);
  };

  // New state for commentaries
  const [commentaries, setCommentaries] = useState([]);
  
  // List of Church Fathers (removed 'All')
  const churchFathers = [
    'Augustine of Hippo',
    'Ambrose of Milan',
    'Athanasius of Alexandria',
    'Basil of Caesarea',
    'Cyril of Alexandria',
    'Gregory of Nazianzus',
    'Gregory of Nyssa',
    'Irenaeus',
    'Jerome',
    'John Chrysostom',
  ];

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    if (debouncedPassage) {
      setPassageKey(prevKey => prevKey + 1);
      setAudioUrl(''); // Clear audio URL immediately
      setAudioError(null); // Clear any previous errors
      fetchPassage(debouncedPassage);
    }
  }, [debouncedPassage]);

  useEffect(() => {
    if (debouncedPassage && showAudio) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      setAudioUrl(''); // Clear audio URL immediately
      setAudioError(null); // Clear any previous errors
      setIsAudioLoading(true);

      fetchAudio(debouncedPassage, abortControllerRef.current.signal);
    }
  }, [debouncedPassage, showAudio]);

  // AI Audio voice fetching removed - not needed

  useEffect(() => {
    if (debouncedSearchQuery) {
      performSearch(debouncedSearchQuery);
    } else {
      setSearchResults([]);
      setSearchError(null);
    }
  }, [debouncedSearchQuery]);

  const performSearch = async (query) => {
    setIsSearchLoading(true);
    setSearchError(null);
    try {
      const response = await fetch(`/api/esv?q=${encodeURIComponent(query)}&endpoint=search`);
      if (!response.ok) {
        throw new Error('Failed to fetch search results.');
      }
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        setSearchResults(data.results);
      } else {
        setSearchResults([]);
        setSearchError('No results found.');
      }
    } catch (error) {
      console.error('Search error:', error);
      setSearchError('Error fetching search results. Please try again.');
    } finally {
      setIsSearchLoading(false);
    }
  };

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
  };

  const handleResultClick = (reference) => {
    setPassage(reference);
    fetchPassage(reference);
    if (isMobile) {
      setIsMenuOpen(false);
    }
    setSearchResults([]);
    setSearchQuery('');
  };

  const fetchPassage = async (passageQuery) => {
    setIsLoading(true);
    try {
      const cachedResponse = await getCachedPassage(passageQuery);
      if (cachedResponse) {
        const { content, cssLink } = cachedResponse;
        setContent(content);
        setCssLink(cssLink);
        setError(null);
      } else {
        const passages = passageQuery.split(',').map(p => p.trim());
        const formattedQuery = passages.map(p => p.replace(/\s+/g, '+')).join(',');

        const response = await fetch(`/api/esv?q=${encodeURIComponent(formattedQuery)}&endpoint=html`);

        if (!response.ok) {
          throw new Error('Network response was not ok');
        }

        const data = await response.json();
        if (data.passages && data.passages.length > 0) {
          const combinedContent = data.passages.join('<hr class="passage-separator" />');

          // Log the raw content for debugging
          console.log('Raw ESV Content:', combinedContent);

          setContent(combinedContent);
          const cssLinkMatch = combinedContent.match(/<link[^>]+>/);
          const extractedCssLink = cssLinkMatch ? cssLinkMatch[0] : '';
          setCssLink(extractedCssLink);
          setError(null);

          await cachePassage(passageQuery, {
            content: combinedContent,
            cssLink: extractedCssLink
          });
        } else {
          setContent('');
          setCssLink('');
          setError('No passage found for the query. Please try a different passage.');
        }
      }
    } catch (error) {
      console.error('Error fetching passage:', error);
      setError('Error fetching passage. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAudio = async (passage, signal) => {
    if (!showAudio) return;
    try {
      const response = await fetch(`/api/esv?q=${encodeURIComponent(passage)}&endpoint=audio`, { signal });
      if (!response.ok) throw new Error('Failed to fetch audio');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Error fetching audio:', error);
        setAudioError('Failed to load audio. Please try again.');
      }
    } finally {
      setIsAudioLoading(false);
    }
  };

  // AI Audio feature removed - fetchAIAudio not needed
  /*
  const fetchAIAudio = useCallback(async (signal) => {
    if (!showAIAudio) return;
    try {
      const response = await fetch(`/api/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ htmlContent: content, voiceName: selectedVoice }),
        signal,
      });
  
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Failed to fetch AI audio: ${errorData.error}`);
      }
  
      // Use MediaSource API to handle streaming audio
      if ('MediaSource' in window) {
        const mediaSource = new MediaSource();
        const url = URL.createObjectURL(mediaSource);
        setAudioUrl(url);
  
        mediaSource.addEventListener('sourceopen', () => {
          const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
  
          const queue = [];
          let isAppending = false;
          let pendingChunk = null;
  
          sourceBuffer.addEventListener('updateend', () => {
            isAppending = false;
            if (pendingChunk) {
              appendNextChunk(pendingChunk);
              pendingChunk = null;
            } else if (queue.length > 0) {
              appendNextChunk();
            }
          });
  
          sourceBuffer.addEventListener('error', (e) => {
            console.error('SourceBuffer error:', e);
          });
  
          const MAX_BUFFER_DURATION = 15;
  
          const reader = response.body.getReader();
  
          const readChunk = () => {
            reader.read().then(({ done, value }) => {
              if (done) {
                // Wait until current data is appended before ending the stream
                if (!isAppending && !sourceBuffer.updating) {
                  mediaSource.endOfStream();
                } else {
                  sourceBuffer.addEventListener('updateend', () => {
                    mediaSource.endOfStream();
                  }, { once: true });
                }
                return;
              }
              queue.push(value);
              if (!isAppending && !sourceBuffer.updating) {
                appendNextChunk();
              }
              readChunk(); // Continue reading
            }).catch((error) => {
              if (error.name === 'AbortError') {
                console.log('Stream reading was aborted.');
                // Handle abort: clean up if necessary
              } else {
                console.error('Error reading stream:', error);
                setAudioError('Error reading audio stream.');
              }
            });
          };
  
          const appendNextChunk = (chunkFromPending) => {
            if (chunkFromPending) {
              isAppending = true;
              sourceBuffer.appendBuffer(chunkFromPending);
            } else if (queue.length > 0 && !sourceBuffer.updating) {
              const chunk = queue.shift();
              const buffered = sourceBuffer.buffered;

              // Check buffer duration and remove old data if necessary
              if (buffered.length > 0) {
                const currentTime = audioRef.current ? audioRef.current.currentTime : 0;
                const bufferStart = buffered.start(0);
                const bufferEnd = buffered.end(buffered.length - 1);
                const bufferedDuration = bufferEnd - bufferStart;

                if (bufferedDuration > MAX_BUFFER_DURATION) {
                  // Calculate the range to remove
                  const removeEnd = Math.min(
                    bufferStart + (bufferedDuration - MAX_BUFFER_DURATION),
                    currentTime - 5 // Keep 5 seconds before currentTime
                  );

                  if (removeEnd > bufferStart) {
                    if (!sourceBuffer.updating) {
                      isAppending = true;
                      pendingChunk = chunk; // Save chunk to append after removal
                      sourceBuffer.remove(bufferStart, removeEnd);
                      return; // Wait for 'updateend' event
                    } else {
                      // Wait for 'updateend' before retrying
                      pendingChunk = chunk;
                      return;
                    }
                  }
                }
              }

              // After ensuring buffer space, append the chunk
              if (!sourceBuffer.updating) {
                isAppending = true;
                try {
                  sourceBuffer.appendBuffer(chunk);
                } catch (e) {
                  console.error('Error appending buffer:', e);
                  setAudioError('Error appending audio buffer.');
                }
              }
            }
          };
  
          readChunk(); // Start reading the stream
        });
      } else {
        // Fallback for browsers without MediaSource support
        const reader = response.body.getReader();
        const chunks = [];
        const readAllChunks = async () => {
          try {
            let done, value;
            while ({ done, value } = await reader.read(), !done) {
              chunks.push(value);
            }
            const blob = new Blob(chunks, { type: 'audio/mpeg' });
            const url = URL.createObjectURL(blob);
            setAudioUrl(url);
          } catch (error) {
            if (error.name === 'AbortError') {
              console.log('Stream reading was aborted.');
              // Handle abort
            } else {
              console.error('Error reading stream:', error);
              setAudioError('Error reading audio stream.');
            }
          }
        };
        readAllChunks();
      }
  
      setAudioError(null);
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Fetch was aborted.');
        // Handle abort: clean up if necessary
      } else {
        console.error('Error fetching AI audio:', error);
        setAudioError('Failed to load AI audio. Please try again.');
        setAudioUrl('');
      }
    } finally {
      setIsAudioLoading(false);
    }
  }, [showAIAudio, content, selectedVoice]);
  */

  const [isScrolling, setIsScrolling] = useState(false);
  const scrollIntervalRef = useRef(null);

  const toggleScroll = () => {
    if (isScrolling) {
      // Stop scrolling
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
      setIsScrolling(false);
    } else {
      // Start scrolling
      const esvTextElement = document.querySelector('.esv-text');
      if (esvTextElement) {
        scrollIntervalRef.current = setInterval(() => {
          const { bottom } = esvTextElement.getBoundingClientRect();
          if (bottom <= window.innerHeight) {
            // Reached the bottom, stop scrolling
            clearInterval(scrollIntervalRef.current);
            scrollIntervalRef.current = null;
            setIsScrolling(false);
          } else {
            window.scrollBy(0, 1); // Scroll by 1 pixel
          }
        }, 100); // Adjust the delay to control the scroll speed
        setIsScrolling(true);
      }
    }
  };

  const handleRewind = () => {
    if (audioRef.current) {
      // Rewind by 15 seconds, but not before the start
      audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 15);
    }
  };

  const handleFastForward = () => {
    if (audioRef.current) {
      // Fast forward by 15 seconds, but not past the end (if duration is known)
      const duration = audioRef.current.duration;
      if (isFinite(duration)) {
        audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 15);
      } else {
        // If duration isn't available yet, just add 15 seconds
        audioRef.current.currentTime += 15;
      }
    }
  };

  const toggleAudio = () => {
    setShowAudio(!showAudio);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    fetchPassage(passage);
    if (isMobile) {
      setIsMenuOpen(false);
    }
  };

  const handlePassageChange = (e) => {
    setPassage(e.target.value);
    
  };

  const handlePassageFocus = () => {
    setIsInputFocused(true);
  };

  const handlePassageBlur = () => {
    setIsInputFocused(false);
  };

  useEffect(() => {
    fetch('/daily-data/readings.csv')
      .then(response => response.text())
      .then(data => {
        Papa.parse(data, {
          header: true,
          complete: (results) => {
            setReadings(results.data);
            // Load saved progress or default to week 1, day 1
            const savedWeek = parseInt(localStorage.getItem('weekNumber')) || 1;
            const savedDay = parseInt(localStorage.getItem('dayNumber')) || 1;
            setWeekNumber(savedWeek);
            setDayNumber(savedDay);
            updatePassage(results.data, savedWeek, savedDay);
          }
        });
      })
      .catch(error => console.error('Error fetching readings:', error));
  }, []);

  const updatePassage = (data, week, day) => {
    const weekData = data[week - 1];
    if (weekData) {
      const dayReading = weekData[`Day ${day}`];
      if (dayReading) {
        setPassage(dayReading.replace(/;/g, ','));
      }
    }
  };

  const handleWeekChange = (e) => {
    const newWeek = parseInt(e.target.value);
    setWeekNumber(newWeek);
    updatePassage(readings, newWeek, dayNumber);
    // Save progress to localStorage
    localStorage.setItem('weekNumber', newWeek);
  };

  const handleDayChange = (e) => {
    const newDay = parseInt(e.target.value);
    setDayNumber(newDay);
    updatePassage(readings, weekNumber, newDay);
    // Save progress to localStorage
    localStorage.setItem('dayNumber', newDay);
  };

  const [highlightInputs, setHighlightInputs] = useState(false);

  const goToNextDay = () => {
    let newDay = dayNumber + 1;
    let newWeek = weekNumber;

    if (newDay > 5) {
      newDay = 1;
      newWeek += 1;
    }

    if (newWeek > readings.length) {
      // Reached the end of the plan
      return;
    }

    setDayNumber(newDay);
    setWeekNumber(newWeek);
    updatePassage(readings, newWeek, newDay);
    // Save progress to localStorage
    localStorage.setItem('weekNumber', newWeek);
    localStorage.setItem('dayNumber', newDay);

    setHighlightInputs(true);
    setTimeout(() => setHighlightInputs(false), 2000); // Remove highlight after 2 seconds
  };

  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);

  const toggleMenu = useCallback(() => {
    if (isMobile) {
      setIsMenuOpen(prevState => !prevState);
    } else {
      setIsDesktopSidebarOpen(prevState => !prevState);
    }
  }, [isMobile]);

  useEffect(() => {
    // Function to check if the device is mobile
    const checkMobile = () => {
      const isMobileView = window.matchMedia('(max-width: 768px)').matches;
      setIsMobile(isMobileView);
    };

    // Initial check and set `isMenuOpen` only once
    const checkMobileAndMenu = () => {
      const isMobileView = window.matchMedia('(max-width: 768px)').matches;
      setIsMobile(isMobileView);
      setIsMenuOpen(!isMobileView);  // Set menu open state only on initial render
    };

    checkMobileAndMenu();  // Run on component mount

    window.addEventListener('resize', checkMobile);  // Listen for resize to update `isMobile`
    return () => window.removeEventListener('resize', checkMobile);  // Clean up on unmount
  }, []);

  // AI Audio feature removed - triple-click handler not needed

  // Calculate progress
  const totalWeeks = readings.length;
  const totalDays = totalWeeks * 5; // Assuming 5 days per week
  const completedDays = (weekNumber - 1) * 5 + dayNumber - 1;
  const remainingDays = totalDays - completedDays;

  const progressPercentage = (completedDays / totalDays) * 100;

  // Update fetchCommentary function
  const fetchCommentary = useCallback(async (passage) => {
    try {
      const passageStrings = passage.split(',').map(p => p.trim());
      const commentaryData = await Promise.all(
        passageStrings.map(async (passageStr) => {
          try {
            const parsed = parsePassageString(passageStr);
            if (!parsed) {
              console.warn(`Invalid passage format: ${passageStr}`);
              return [];
            }
            const { book, chapterRangeStr } = parsed;
            const chapters = parseChapterRange(chapterRangeStr);
            const bookCommentaries = await Promise.all(
              chapters.map(async (chapter) => {
                try {
                  const fileName = `${book.toLowerCase()}_chapter_${chapter}.json`;
                  const response = await fetch(`/daily-data/commentaries/${fileName}`);
                  if (!response.ok) {
                    console.warn(`Commentary not found for ${book} chapter ${chapter}`);
                    return [];
                  }
                  const data = await response.json();
                  // Filter commentaries based on selected father
                  const filteredCommentaries = data.filter(c => c.father_name === selectedFather);
                  return { book, chapter, commentaries: filteredCommentaries };
                } catch (error) {
                  console.warn(`Error fetching commentary for ${book} chapter ${chapter}:`, error);
                  return [];
                }
              })
            );
            return bookCommentaries.flat();
          } catch (error) {
            console.error('Error parsing passage string:', error);
            return [];
          }
        })
      );

      setCommentaries(commentaryData.flat());
    } catch (error) {
      console.error('Error fetching commentary:', error);
      setCommentaries([]);
    }
  }, [selectedFather]);

  useEffect(() => {
    if (passage) {
      fetchCommentary(passage);
    }
  }, [passage, fetchCommentary, selectedFather]);

  return (
    <div className={`relative overflow-x-hidden min-h-screen flex flex-col bg-background text-foreground ${
      theme === 'dark' ? 'dark' : ''
    } ${inter.className}`}>
      {/* Header - Classical warm styling */}
      <header className="w-full px-2 sm:px-3 py-3 bg-background border-b border-border text-foreground flex justify-between items-center fixed top-0 left-0 right-0 z-30 h-14">
        <div className="flex items-center gap-2 sm:gap-4">
          <AppNav />
          <div className="flex items-baseline gap-2">
            <h1 className={`${merriweather.className} text-lg font-semibold tracking-wide text-primary font-serif hidden sm:block`}>
              Daily Bible Readings
            </h1>
            <span className="text-xs font-normal text-muted-foreground font-serif hidden lg:inline">
              and church father commentary
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <button
            className="text-xl bg-transparent border-none cursor-pointer text-primary hover:scale-110 transition-transform"
            onClick={toggleMenu}
          >
            ☰
          </button>
          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="text-xl bg-transparent border-none cursor-pointer text-primary hover:scale-110 transition-transform"
          >
            {theme === 'light' ? <FaSun /> : <FaMoon />}
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="https://buymeacoffee.com/biblos"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-amber-500 transition-colors p-2"
                onClick={() => track('coffee_click', { location: 'header' })}
                onMouseEnter={() => track('coffee_hover', { location: 'header' })}
              >
                <Coffee className="w-5 h-5" strokeWidth={1.5} />
              </a>
            </TooltipTrigger>
            <TooltipContent>
              <p>Support the development of new features and tools.</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* Sidebar - Classical warm styling */}
      <div
        ref={sidebarRef}
        className={`fixed top-14 left-0 bottom-0 bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out z-20 ${
          isMobile
            ? isMenuOpen ? 'w-full md:w-80' : 'w-0 overflow-hidden'
            : isDesktopSidebarOpen ? 'md:w-80' : 'w-0 overflow-hidden'
        } flex flex-col`}
      >
        {/* Content area and footer */}
        <div className="flex flex-col h-full">
          <div className="flex-grow p-4 sm:p-6 md:p-3 flex flex-col gap-3 sm:gap-6 md:gap-2 overflow-y-auto">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4 sm:gap-5 md:gap-2">
              {/* Week and Day Selectors - Classical styling */}
              <div className="flex gap-3 md:gap-2">
                <select
                  value={weekNumber}
                  onChange={handleWeekChange}
                  className="flex-1 p-2 md:p-1 border border-border rounded bg-input text-foreground text-sm md:text-xs h-10 md:h-auto font-serif"
                >
                  {readings.map((_, index) => (
                    <option key={index} value={index + 1}>Week {index + 1}</option>
                  ))}
                </select>
                <select
                  value={dayNumber}
                  onChange={handleDayChange}
                  className="flex-1 p-2 md:p-1 border border-border rounded bg-input text-foreground text-sm md:text-xs h-10 md:h-auto font-serif"
                >
                  {[1, 2, 3, 4, 5].map((day) => (
                    <option key={day} value={day}>Day {day}</option>
                  ))}
                </select>
              </div>
              {/* Passage Input - Classical styling */}
              <input
                type="text"
                value={passage}
                onChange={handlePassageChange}
                onFocus={handlePassageFocus}
                onBlur={handlePassageBlur}
                placeholder="Enter Passage (e.g., Genesis 1-2)"
                className="p-2 md:p-1 border border-border rounded bg-input text-foreground text-sm md:text-xs font-serif placeholder:text-muted-foreground"
              />
              {/* Buttons - Classical styling */}
              <div className="flex gap-2">
                <button type="submit" className="flex-1 p-2 md:p-1 bg-primary text-primary-foreground border-none rounded cursor-pointer transition-all duration-300 flex items-center justify-center gap-2 text-sm md:text-xs hover:opacity-90 font-serif">
                  <FaBook /> Get Reading
                </button>

                <button
                  onClick={goToNextDay}
                  disabled={weekNumber === readings.length && dayNumber === 5}
                  className="flex-1 p-2 md:p-1 bg-accent text-accent-foreground border-none rounded cursor-pointer transition-all duration-300 flex items-center justify-center gap-2 text-sm md:text-xs hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed font-serif"
                >
                  Mark Complete
                </button>
              </div>
            </form>

            {/* Audio Options - Classical styling */}
            <div className="flex items-center mt-2 md:mt-1">
              <label className="flex items-center cursor-pointer mr-4">
                <input
                  type="checkbox"
                  checked={showAudio}
                  onChange={toggleAudio}
                  className="mr-2 w-4 h-4 md:w-3 md:h-3 accent-primary"
                />
                <FaVolumeUp className="text-primary mr-2 text-base md:text-sm" />
                <span className="text-sidebar-foreground text-sm md:text-xs font-serif">ESV Audio</span>
              </label>
            </div>

            {/* Commentary Checkbox - Classical styling */}
            <div className="flex items-center mt-2 md:mt-1">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCommentary}
                  onChange={toggleCommentary}
                  className="mr-2 w-4 h-4 md:w-3 md:h-3 accent-primary"
                />
                <FaCommentAlt className="text-primary mr-2 text-base md:text-sm" />
                <span className="text-sidebar-foreground text-sm md:text-xs font-serif">Show Commentary</span>
              </label>
            </div>

            {/* Father Filter Dropdown - Classical styling */}
            {showCommentary && (
              <div className="mt-2 md:mt-1">
                <div className="relative">
                  <select
                    value={selectedFather}
                    onChange={handleFatherChange}
                    className="w-full p-2 md:p-1 pr-8 border border-border rounded bg-input text-foreground text-sm md:text-xs appearance-none font-serif"
                  >
                    {churchFathers.map((father) => (
                      <option key={father} value={father}>
                        {father}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2">
                    <FaFilter className="text-muted-foreground text-base md:text-sm" />
                  </div>
                </div>
              </div>
            )}

            {/* Search Bar - Classical styling */}
            <div className="flex items-center mt-2 md:mt-1">
              <div className="relative w-full">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  placeholder="Search ESV..."
                  className="w-full p-2 md:p-1 pr-8 border border-border rounded bg-input text-foreground text-sm md:text-xs font-serif placeholder:text-muted-foreground"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                  <FaSearch className="text-muted-foreground text-base md:text-sm" />
                </div>
              </div>
            </div>

            {/* Link to semantic search */}
            <a
              href="/"
              className="text-xs text-accent hover:opacity-80 transition-opacity font-serif flex items-center gap-1 mt-1"
            >
              <span>Try Semantic Search</span>
              <span className="text-[10px]">→</span>
            </a>

            {/* Search Results - Classical styling */}
            {isSearchLoading && (
              <p className="text-sm md:text-xs text-sidebar-foreground mt-1 font-serif">Searching...</p>
            )}
            {searchError && (
              <p className="text-sm md:text-xs text-destructive mt-1 font-serif">{searchError}</p>
            )}
            {searchResults.length > 0 && (
              <ul className="mt-1 bg-card border border-border rounded p-2 md:p-1 max-h-[calc(100vh-450px)] md:max-h-[calc(100vh-400px)] overflow-y-auto">
                {searchResults.map((result, index) => (
                  <li
                    key={index}
                    onClick={() => handleResultClick(result.reference)}
                    className="p-2 md:p-1 cursor-pointer hover:bg-muted rounded transition-colors duration-200"
                  >
                    <span className="font-semibold text-primary text-sm md:text-xs font-serif">
                      {result.reference}
                    </span>
                    <p className="text-sm md:text-xs text-foreground mt-1 font-serif">
                      {result.content}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {/* Progress Indicator - Classical styling */}
            <div className="mt-auto mb-2">
              <h2 className="text-base md:text-sm font-semibold text-sidebar-foreground mb-1 font-serif">Progress</h2>
              <div className="w-full bg-secondary rounded-full h-4 mb-2 border border-border">
                <div
                  className="bg-primary h-4 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercentage}%` }}
                ></div>
              </div>
              <p className="text-xs text-sidebar-foreground font-serif">
                {completedDays}/{totalDays} days ({remainingDays} left)
              </p>
            </div>
          </div>
          {/* Footer - Classical styling */}
          <div className="p-3 bg-secondary border-t border-border text-xs text-sidebar-foreground flex items-center justify-center flex-shrink-0">
            <div className="flex items-center font-serif">
              <span>Made with <FaHeart className="text-red-500 mx-1 inline" /> by</span>
              <a
                href="https://github.com/dssjon"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center ml-1 text-primary hover:opacity-80 transition-opacity duration-200 font-semibold"
              >
                Jon Boldt
                <FaGithub className="ml-1" />
              </a>
              <span className="mx-1">-</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href="https://buymeacoffee.com/biblos"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors group"
                    onClick={() => track('coffee_click', { location: 'footer' })}
                    onMouseEnter={() => track('coffee_hover', { location: 'footer' })}
                  >
                    <Coffee className="w-3 h-3 inline-block align-middle group-hover:text-amber-500 transition-colors" strokeWidth={1.5} />
                  </a>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Support the development of new features and tools.</p>
                </TooltipContent>
              </Tooltip>
             </div>
           </div>
         </div>
        </div>

      {/* Main Content */}
      <main className={`flex-1 pt-16 transition-all duration-300 ease-in-out ${
        isMobile
          ? isMenuOpen ? 'md:ml-80' : ''
          : isDesktopSidebarOpen ? 'md:ml-80' : ''
      } text-foreground ${isMenuOpen && isMobile ? 'hidden' : ''} ${merriweather.className}`}>
        {isLoading ? (
          <div className="flex justify-center items-center h-full">
            <div className="animate-spin rounded-full h-12 w-12 sm:h-16 sm:w-16 border-t-2 border-b-2 border-gray-900 dark:border-gray-100"></div>
          </div>
        ) : (
          <div className={`flex flex-col lg:flex-row ${showCommentary ? 'h-screen' : ''}`}>
            {/* Bible Content */}
            <div className={`w-full
              ${showCommentary
                ? 'lg:w-2/3 px-4 sm:px-6 lg:px-8 overflow-y-auto h-1/2 lg:h-auto'
                : 'px-4 sm:px-6 lg:w-[85%] lg:pl-6 lg:pr-24 pb-16'}`}>
              {showAudio && (
                <div className="mb-8">
                  {isAudioLoading ? (
                    <p className="text-sm sm:text-base">Loading audio...</p>
                  ) : audioUrl ? (
                    <>
                      <div className="flex items-center gap-2">
                        <audio
                          key={passageKey}
                          ref={audioRef}
                          src={audioUrl}
                          onError={(e) => setAudioError(`Error loading audio: ${e.target.error.message}`)}
                          controls
                          className="flex-grow"
                        />
                        {showAudio && (
                          <>
                            <button
                              onClick={handleRewind}
                              className="p-2 bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity duration-200"
                              title="Rewind 15s"
                              aria-label="Rewind 15 seconds"
                            >
                              <FaBackward />
                            </button>
                            <button
                              onClick={handleFastForward}
                              className="p-2 bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity duration-200"
                              title="Forward 15s"
                              aria-label="Fast Forward 15 seconds"
                            >
                              <FaForward />
                            </button>
                          </>
                        )}
                      </div>
                      {audioError && (
                        <p className="text-red-500 text-sm mt-2">
                          {audioError}. Try using a different browser or updating your current one.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm sm:text-base">Audio will be available once loaded.</p>
                  )}
                </div>
              )}
              <div
                className="esv-text text-base sm:text-lg leading-relaxed sm:leading-normal mt-4"
                dangerouslySetInnerHTML={{ __html: content }}
              />
              {/* Scroll button - Classical styling */}
              <button
                onClick={toggleScroll}
                className="fixed bottom-4 right-4 p-3 bg-primary text-primary-foreground border-none rounded cursor-pointer transition-opacity duration-300 flex items-center justify-center gap-2 text-sm hover:opacity-90 shadow-lg font-serif"
              >
                {isScrolling ? 'Stop' : 'Scroll'}
              </button>
            </div>

            {/* Commentary and Summaries */}
            {isCommentaryLoaded && showCommentary && (
              <div className={`w-full lg:w-1/3 px-4 sm:px-6 lg:px-8 lg:border-l lg:border-gray-300 lg:dark:border-gray-700 overflow-y-auto transition-opacity duration-300 h-1/2 lg:h-auto`}>
                <div className="h-full flex flex-col">
                  {/* Commentary Sections */}
                  <div className={`flex-grow overflow-y-auto`}>
                    {commentaries.map((item, index) => (
                      <CommentarySection
                        key={index}
                        book={item.book}
                        chapter={item.chapter}
                        commentaries={item.commentaries}
                        selectedFather={selectedFather}
                        isMobile={isMobile}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Analytics and Scripts */}
      <Analytics />
      <script dangerouslySetInnerHTML={{
        __html: `
          window.si = window.si || function () { (window.siq = window.siq || []).push(arguments); };
        `
      }} />
      <script defer src="/_vercel/speed-insights/script.js"></script>
      <script defer src="/_vercel/insights/script.js"></script>
    </div>
  );
}

// Updated CommentarySection component
function CommentarySection({ book, chapter, commentaries, selectedFather, isMobile }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [summary, setSummary] = useState(null);
  const [summaryData, setSummaryData] = useState(null);
  const [highlightedExcerptIndex, setHighlightedExcerptIndex] = useState(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState(null);
  const [showSummary, setShowSummary] = useState(false);

  const key = `${book}-${chapter}`;

  // Sort commentaries by file_name without mutating prop array
  const sortedCommentaries = [...commentaries].sort((a, b) => {
    const aName = a.file_name.replace('.toml', '');
    const bName = b.file_name.replace('.toml', '');
    return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
  });

  // Add this useEffect to clear the summary when selectedFather changes
  useEffect(() => {
    setSummary(null);
    setSummaryData(null);
    setHighlightedExcerptIndex(null);
    setShowSummary(false);
    setSummaryError(null);
  }, [selectedFather]);

  const toggleExpand = () => setIsExpanded(!isExpanded);

  // Function to generate summary for this commentary section
  const generateSummary = async () => {
    setIsSummarizing(true);
    setSummaryError(null);
    setSummary('Generating summary...');
    setSummaryData(null);

    try {
      const response = await fetch('/api/summary-daily', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          book,
          chapter,
          commentaryData: sortedCommentaries,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch summary for ${key}`);
      }

      const data = await response.json();
      setSummary(data.summary);
      setSummaryData(data);
      setShowSummary(true);
    } catch (error) {
      console.error(error);
      setSummaryError("Summary generation failed.");
      setShowSummary(false);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleCitationClick = (citation) => {
    const idx = citation.documentIndex;
    setHighlightedExcerptIndex(idx);
    const el = document.getElementById(`commentary-${key}-${idx}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className={`mt-6 p-4 bg-card border border-border rounded-lg ${isMobile ? 'h-auto' : ''}`}>
      <div className="flex justify-between items-center mb-3">
        <h4
          className="text-xl font-bold text-primary cursor-pointer flex items-center font-serif"
          onClick={toggleExpand}
        >
          {capitalizeFirstLetter(book)} {chapter}
          {isExpanded ? <FaChevronUp className="ml-2" /> : <FaChevronDown className="ml-2" />}
        </h4>
        <button
          onClick={generateSummary}
          className="p-2 bg-accent text-accent-foreground rounded-full hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground transition-opacity duration-300"
          disabled={isSummarizing}
          title="Generate Summary"
        >
          {isSummarizing ? (
            <FaSyncAlt className="animate-spin" />
          ) : (
            <FaRegFileAlt />
          )}
        </button>
      </div>
      {isExpanded && (
        <div className={`text-foreground ${isMobile ? 'overflow-y-visible' : ''}`}>
          {/* Summary Container - Classical styling */}
          {showSummary && summary && (
            <div className="mb-6 p-4 bg-secondary border-l-2 border-primary rounded">
              <h5 className="text-lg font-semibold mb-2 text-primary font-serif">Summary</h5>
              {summaryError ? (
                <p className="text-destructive font-serif">{summaryError}</p>
              ) : summaryData?.citations?.length > 0 ? (
                <CitedSummary
                  summary={summary}
                  segments={summaryData.segments}
                  citations={summaryData.citations}
                  onCitationClick={handleCitationClick}
                  serif
                />
              ) : (
                <ReactMarkdown
                  components={{
                    h1: ({node, ...props}) => <h1 className="text-lg font-semibold mt-4 mb-2 text-primary font-serif" {...props} />,
                    h2: ({node, ...props}) => <h2 className="text-base font-semibold mt-3 mb-2 text-primary font-serif" {...props} />,
                    h3: ({node, ...props}) => <h3 className="text-sm font-semibold mt-2 mb-1 text-primary font-serif" {...props} />,
                    p: ({node, ...props}) => <p className="text-sm mb-3 leading-relaxed text-foreground font-serif" {...props} />,
                    ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-3 text-sm font-serif" {...props} />,
                    ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-3 text-sm font-serif" {...props} />,
                    li: ({node, ...props}) => <li className="mb-1 text-foreground leading-relaxed" {...props} />,
                    strong: ({node, ...props}) => <strong className="font-semibold text-primary" {...props} />,
                    em: ({node, ...props}) => <em className="italic text-muted-foreground" {...props} />,
                  }}
                >
                  {summary}
                </ReactMarkdown>
              )}
            </div>
          )}

          {/* Commentaries - Classical styling */}
          <div className="mt-4">
            {sortedCommentaries.length > 0 ? (
              sortedCommentaries.map((commentary, index) => (
                <div
                  key={index}
                  id={`commentary-${key}-${index}`}
                  className={`mb-6 pb-6 border-b border-border last:border-b-0 rounded transition-colors ${
                    highlightedExcerptIndex === index ? "bg-primary/10 p-3 -mx-3" : ""
                  }`}
                >
                  <p className="font-semibold mb-2 text-lg text-primary font-serif">{commentary.father_name}</p>
                  <p className="text-sm mb-2 text-muted-foreground italic font-serif">{commentary.source_title}</p>
                  <p className="text-sm mb-4 leading-relaxed text-foreground font-serif">{commentary.txt}</p>
                  <p className="text-xs mb-1 text-muted-foreground font-serif"><span className="font-medium">Ref:</span> {commentary.file_name.replace('.toml', '')}</p>
                  {commentary.source_url && (
                    <a
                      href={commentary.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:opacity-80 text-xs font-serif underline"
                    >
                      View Source
                    </a>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm italic text-muted-foreground font-serif">No commentaries available for {selectedFather}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper Function to Capitalize First Letter
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}
