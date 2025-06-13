// Internal data structure for simulating related words
// This is a simple lookup table. A more complex version could
// generate associations dynamically based on patterns.
// const relations = {
//     "cat": ["dog", "pet", "feline", "meow", "animal", "purr"],
//     "dog": ["cat", "pet", "canine", "bark", "animal", "bone"],
//     "animal": ["cat", "dog", "bear", "lion", "creature", "species"],
//     "computer": ["keyboard", "screen", "software", "program", "technology", "internet"],
//     "technology": ["computer", "internet", "science", "innovation", "digital", "future"],
//     "science": ["experiment", "theory", "research", "knowledge", "technology", "physics"],
//     "internet": ["web", "online", "network", "communication", "computer", "data"],
//     "book": ["read", "page", "story", "author", "library", "knowledge"],
//     "music": ["song", "sound", "artist", "instrument", "melody", "listen"],
//     "art": ["painting", "sculpture", "artist", "creative", "visual", "gallery"],
//     "food": ["eat", "delicious", "kitchen", "cook", "taste", "recipe"],
//     "car": ["drive", "road", "engine", "wheel", "vehicle", "travel"],
//     "travel": ["journey", "explore", "destination", "adventure", "car", "plane"],
//     "home": ["house", "family", "comfort", "live", "place", "belong"],
//     "friend": ["buddy", "pal", "companion", "trust", "support", "together"],
//     "happy": ["joy", "smile", "glad", "positive", "feeling", "cheer"],
//     "sad": ["unhappy", "cry", "grief", "negative", "feeling", "blue"],
//     "knowledge": ["learn", "fact", "information", "study", "understand", "science"],
//     // Add more words to expand the network
// };

// Function to generate related words (simulated)
// function generateRelatedWords(word) {
//     const lowerWord = word.toLowerCase().trim();
//     const related = relations[lowerWord];

//     if (related && related.length > 0) {
//         // Shuffle and take up to 5 related words
//         return related.sort(() => 0.5 - Math.random()).slice(0, Math.min(5, related.length));
//     } else {
//         // Fallback for unknown words
//         // Generate some generic fallback concepts
//         const fallbacks = ["concept", "idea", "thing", "relation", "unknown"];
//          return fallbacks.sort(() => 0.5 - Math.random()).slice(0, Math.min(3, fallbacks.length));
//     }
// }

// Function to generate related concepts using the AI model
async function generateRelatedConcepts(word) {
    const lowerWord = word.toLowerCase().trim();

    if (!lowerWord) {
        return []; // Return empty if word is empty
    }

    try {
        // Use the AI model to generate related concepts
        const completion = await websim.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are a knowledge graph generator. Given a single word, provide a list of 5-7 concepts closely related to it.
Respond directly with JSON, following this JSON schema, and no other text.
{
  "related_concepts": string[];
}`,
                },
                {
                    role: "user",
                    content: lowerWord,
                },
            ],
            json: true, // Request JSON output
        });

        const result = JSON.parse(completion.content);

        if (result && Array.isArray(result.related_concepts)) {
            // Filter out potential duplicates and the original word itself
            const uniqueConcepts = [...new Set(result.related_concepts)]
                .filter(concept => concept.toLowerCase() !== lowerWord)
                .slice(0, 7); // Limit to 7 concepts

            return uniqueConcepts;
        } else {
            console.warn("AI did not return expected JSON format.", completion.content);
            return []; // Return empty array if format is unexpected
        }

    } catch (error) {
        console.error("Error calling AI model:", error);
        // Fallback or error handling
        return ["error", "network", "ai", "failed", "try again"];
    }
}


// Function to render the visualization using SVG
function renderGraph(centerWord, relatedWords, container) {
    // Clear previous content
    container.innerHTML = '';

    if (!relatedWords || relatedWords.length === 0) {
         container.innerHTML = `<p class="placeholder">No related concepts found for "${centerWord}". Try another word?</p>`;
         return;
    }

    // Create SVG element
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 800 500"); // Match container size or aspect
    container.appendChild(svg);

    const width = 800;
    const height = 500;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = 200; // Radius for related words

    // Center Node
    const centerNodeGroup = createNode(centerX, centerY, centerWord, "center-node");
    svg.appendChild(centerNodeGroup);

    // Related Nodes and Lines
    relatedWords.forEach((word, index) => {
        // Calculate position in a circle around the center
        const angle = (Math.PI * 2 / relatedWords.length) * index;
        const nodeX = centerX + radius * Math.cos(angle);
        const nodeY = centerY + radius * Math.sin(angle);

        // Create line
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", centerX);
        line.setAttribute("y1", centerY);
        line.setAttribute("x2", nodeX);
        line.setAttribute("y2", nodeY);
        line.classList.add("relation-line");
        svg.appendChild(line); // Add lines first so nodes are on top

        // Create node
        const nodeGroup = createNode(nodeX, nodeY, word, "concept-node");
        svg.appendChild(nodeGroup);

        // Add click listener to related nodes
        nodeGroup.addEventListener('click', () => {
            exploreWord(word, container); // Explore the clicked word
        });
    });
}

// Helper function to create an SVG node group (circle + text)
function createNode(x, y, text, className) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add(className);
    group.setAttribute("transform", `translate(${x}, ${y})`);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    const radius = 30 + text.length * 1.5; // Radius based on text length
    circle.setAttribute("r", Math.max(30, radius));

    const textElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
    textElement.textContent = text;

    group.appendChild(circle);
    group.appendChild(textElement);

    return group;
}


// Main function to handle exploration
async function exploreWord(word, container) { // Make function async
    if (!word || word.trim() === "") {
        // Display placeholder if input is empty
        container.innerHTML = '<p class="placeholder">Please enter a word.</p>';
        return;
    }

    // Show a loading indicator
    container.innerHTML = `<p class="placeholder">Exploring "${word}"...</p>`;

    // Generate related words using the AI model
    const relatedWords = await generateRelatedConcepts(word); // Use async function

    // Render the graph
    renderGraph(word, relatedWords, container);
}


// Setup function called from index.js
export function setupConceptConstellation(wordInput, exploreButton, visualizationArea) {
    // Add event listener to the button
    exploreButton.addEventListener('click', () => {
        const word = wordInput.value;
        exploreWord(word, visualizationArea);
    });

    // Optional: Allow pressing Enter in the input field
    wordInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent form submission
            exploreButton.click();
        }
    });

    // Initial state: display placeholder
    visualizationArea.innerHTML = '<p class="placeholder">Enter a word above and click \'Explore\' to see the concept constellation.</p>';
}