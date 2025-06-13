import { setupConceptConstellation } from "./conceptConstellation.js";

// Get references to DOM elements
const wordInput = document.getElementById('wordInput');
const exploreButton = document.getElementById('exploreButton');
const visualizationArea = document.getElementById('visualizationArea');

// Initialize the constellation setup
setupConceptConstellation(wordInput, exploreButton, visualizationArea);

