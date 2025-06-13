import { setupConceptConstellation } from "./conceptConstellation.js";

// Get references to DOM elements
const wordInput = document.getElementById('wordInput');
const exploreButton = document.getElementById('exploreButton');
const visualizationArea = document.getElementById('visualizationArea');

// Get references for the help modal
const helpButton = document.getElementById('helpButton');
const helpModal = document.getElementById('helpModal');
const closeModalButton = document.getElementById('closeModalButton');

// Function to show the modal
function showModal() {
    helpModal.classList.add('visible');
}

// Function to hide the modal
function hideModal() {
    helpModal.classList.remove('visible');
}

// Add event listeners for the modal
helpButton.addEventListener('click', showModal);
closeModalButton.addEventListener('click', hideModal);

// Optional: Close modal if clicking outside the content
helpModal.addEventListener('click', (event) => {
    if (event.target === helpModal) {
        hideModal();
    }
});

// Initialize the constellation setup
setupConceptConstellation(wordInput, exploreButton, visualizationArea);