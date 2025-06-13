import * as d3 from "d3";

// Global graph data structure
let graphData = {
    nodes: [],
    links: []
};

let svg; // Declare svg globally to access it
let simulation; // Declare simulation globally
let linkGroup; // Declare link group globally
let nodeGroup; // Declare node group globally
let currentContainer; // Store the visualization container element


// Function to generate related concepts using the AI model
async function generateRelatedConcepts(word) {
    const lowerWord = word.toLowerCase().trim();

    if (!lowerWord) {
        return []; // Return empty if word is empty
    }

    try {
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
            // Filter out potential duplicates and the original word itself, and clean strings
            const uniqueConcepts = [...new Set(result.related_concepts)]
                .map(concept => concept.trim().replace(/^['"]|['"]$/g, '')) // Clean potential quotes/spaces
                .filter(concept => concept !== "" && concept.toLowerCase() !== lowerWord) // Filter empty strings and the original word
                .slice(0, 7); // Limit to 7 concepts

            return uniqueConcepts;
        } else {
            console.warn("AI did not return expected JSON format.", completion.content);
            return []; // Return empty array if format is unexpected
        }

    } catch (error) {
        console.error("Error calling AI model:", error);
        // Fallback or error handling - can return empty or a generic message
        // Returning empty means no new nodes are added on error
        return [];
    }
}


// Function to calculate radius based on text length
function getNodeRadius(text) {
    // Max of 25, or 15 + 3px per character length - adjusted for better fit
    return Math.max(20, 10 + (text ? text.length : 0) * 3);
}


// Define the tick function to update positions
function ticked() {
    if (!linkGroup || !nodeGroup) {
        // This check should ideally not be needed if simulation is stopped correctly,
        // but serves as a safeguard against the TypeError if tick runs unexpectedly.
        console.error("Tick function called but linkGroup or nodeGroup is null. Simulation might not have been stopped.");
        return;
    }
    linkGroup.selectAll("line")
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

    nodeGroup.selectAll("g") // Select the group containing circle and text
        .attr("transform", d => `translate(${d.x},${d.y})`);
}

// Drag functions
function dragstarted(event) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  event.subject.fx = event.subject.x;
  event.subject.fy = event.subject.y;
}

function dragged(event) {
  event.subject.fx = event.x;
  event.subject.fy = event.y;
}

function dragended(event) {
  if (!event.active) simulation.alphaTarget(0);
  // Optional: uncomment to let forces take over after drag ends
  // event.subject.fx = null;
  // event.subject.fy = null;
}


// Function to initialize or update the visualization using D3
function renderGraph(container) {
    currentContainer = container; // Store container reference

    // --- Handle Placeholder State ---
    if (graphData.nodes.length === 0) {
        // If simulation exists, stop it before removing elements
        if (simulation) {
            simulation.stop();
        }
        // Clear any existing SVG or content
        container.innerHTML = '<p class="placeholder">Enter a word above and click \'Explore\' to see the concept constellation.</p>';
        // Reset D3 selections and simulation reference to indicate no graph is rendered
        svg = null;
        simulation = null;
        linkGroup = null;
        nodeGroup = null;
        return; // Stop execution here
    }

    // --- Create/Select SVG and Groups ---
    // If SVG doesn't exist (because we just moved from placeholder state or initial load)
    if (!svg) {
        container.innerHTML = ''; // Clear placeholder content
        svg = d3.select(container)
                .append("svg")
                .attr("viewBox", "0 0 800 500"); // Match container size

        // Create groups for links and nodes
        linkGroup = svg.append("g").attr("class", "links");
        nodeGroup = svg.append("g").attr("class", "nodes");

        // Initialize the force simulation
        simulation = d3.forceSimulation(graphData.nodes)
            .force("link", d3.forceLink(graphData.links).id(d => d.id).distance(100)) // Link force with specified distance
            .force("charge", d3.forceManyBody().strength(-300)) // Node repulsion force
            .force("center", d3.forceCenter(400, 250)) // Center force (center of 800x500 viewbox)
            .on("tick", ticked); // Attach tick handler
    } else {
        // If SVG exists, update simulation data
        simulation.nodes(graphData.nodes);
        simulation.force("link").links(graphData.links);
        // The simulation will be restarted below if needed
    }


    // --- D3 Data Binding and Update ---

    // Update links using join
    const links = linkGroup.selectAll("line")
        .data(graphData.links, d => d.source.id + "-" + d.target.id); // Use a key function for efficient updates

    links.join(
        enter => enter.append("line")
            .attr("class", "relation-line"), // Add class for styling
        update => update, // No specific updates needed for existing lines currently
        exit => exit.remove() // Remove old links that are no longer in data
    );


    // Update nodes (using groups for circle+text) using join
    const nodes = nodeGroup.selectAll("g")
        .data(graphData.nodes, d => d.id); // Use node id as key

    nodes.join(
        enter => {
            // Create new group for each entering node
            const newNodeGroup = enter.append("g")
                .attr("class", d => d.isCenter ? "center-node" : "concept-node")
                .call(d3.drag() // Apply drag behavior to *all* entering nodes
                    .on("start", dragstarted)
                    .on("drag", dragged)
                    .on("end", dragended))
                .on("click", (event, d) => { // Add click listener for exploration
                     // Prevent immediate exploration if just finished dragging
                     if (event.defaultPrevented) return;
                     // Explore the clicked node's relations
                     handleExplore(d.id, currentContainer, d.id);
                });

            // Append circle and text to the new group
            newNodeGroup.append("circle")
                 .attr("r", d => getNodeRadius(d.text)); // Set radius based on text

            newNodeGroup.append("text")
                 .attr("dy", "0.35em") // Vertical alignment
                 .attr("text-anchor", "middle") // Horizontal alignment
                 .style("pointer-events", "none") // Ensure text doesn't block clicks
                 .style("user-select", "none") // Prevent text selection
                 .text(d => d.text); // Set text content

            return newNodeGroup; // Return the new group selection
        },
        update => {
             // Update attributes for existing nodes if needed (e.g., radius, text)
             // The drag and click listeners applied during enter persist.
             update.select("circle").attr("r", d => getNodeRadius(d.text));
             update.select("text").text(d => d.text); // Update text might be necessary if node data changed
             return update; // Return the update selection
        },
        exit => exit.remove() // Remove old nodes that are no longer in data
    );

    // Restart simulation with updated data if it's not already running strongly
    if (simulation.alpha() < 0.1) { // Check if simulation is close to settling
         simulation.alpha(1).restart(); // Restart with full strength
    }
}


// Main function to handle exploration or node click
async function handleExplore(word, container, clickedNodeId = null) {
    const lowerWord = word.toLowerCase().trim();

    if (!lowerWord) {
        if (!clickedNodeId) { // Only clear and show placeholder if initiating from an empty input
             graphData.nodes = [];
             graphData.links = [];
             renderGraph(container); // Re-render to clear the SVG and show placeholder
        }
        return;
    }

    // Determine if this is a completely new exploration from the input box
    const isInitialInputExplore = !clickedNodeId;

    if (isInitialInputExplore) {
        // If starting fresh from input, clear previous graph data completely
        graphData.nodes = [];
        graphData.links = [];
        // Add the new central node. This is the *only* node marked as the initial center.
        graphData.nodes.push({ id: lowerWord, text: lowerWord, isCenter: true });
    } else {
         // If clicking an existing node, check if it exists. Add if somehow missing (shouldn't happen).
         const targetNodeExists = graphData.nodes.some(n => n.id === lowerWord);
         if (!targetNodeExists) {
             console.warn(`Clicked node "${lowerWord}" not found in graphData, adding it.`);
             // Add the clicked node - it's not the initial center
             graphData.nodes.push({ id: lowerWord, text: lowerWord, isCenter: false });
         }
         // Note: When clicking a node, we add its related concepts and links to the existing graph.
         // The 'isCenter' property of the clicked node itself is not changed here.
    }


    // Add loading indicator
    const loadingOverlay = document.createElement('div');
    loadingOverlay.classList.add('loading-overlay');
    loadingOverlay.textContent = `Exploring "${lowerWord}"...`;
    // Assume visualizationArea is the container for the overlay
    const overlayContainer = container;
    // Ensure position is relative for absolute overlay positioning
    overlayContainer.style.position = 'relative';

    // Check if a loading overlay already exists and update its text, or append a new one
     const existingLoadingOverlay = overlayContainer.querySelector('.loading-overlay');
     if (!existingLoadingOverlay) {
        overlayContainer.appendChild(loadingOverlay);
     } else {
        existingLoadingOverlay.textContent = loadingOverlay.textContent; // Update text if exists
     }


    // Call AI to get related concepts
    const relatedConcepts = await generateRelatedConcepts(lowerWord);

    // Remove loading indicator after AI call
    const currentLoadingOverlay = overlayContainer.querySelector('.loading-overlay');
    if (currentLoadingOverlay) {
         currentLoadingOverlay.remove();
    }


    // Add new nodes and links to graphData
    relatedConcepts.forEach(concept => {
        const cleanConcept = concept.trim();

        if (!cleanConcept || cleanConcept.toLowerCase() === lowerWord) {
             // Skip empty strings or the original word itself (already filtered in generateRelatedConcepts, but double-check)
            return;
        }

        // Add node if it doesn't exist
        const existingNode = graphData.nodes.find(n => n.id === cleanConcept);
        if (!existingNode) {
            // Add new node. D3 simulation will position it. Not the initial center.
             graphData.nodes.push({ id: cleanConcept, text: cleanConcept, isCenter: false });
        }

        // Add link if it doesn't exist (check both directions)
        const linkExists = graphData.links.some(link =>
            // Check using node IDs (source and target properties can be IDs or objects)
            (link.source.id === lowerWord && link.target.id === cleanConcept) ||
            (link.source.id === cleanConcept && link.target.id === lowerWord)
        );

        if (!linkExists) {
             // Add link using node IDs; D3's forceLink.id() will resolve them to node objects
            graphData.links.push({ source: lowerWord, target: cleanConcept });
        }
    });

    // Render the updated graph with the newly added nodes and links
    renderGraph(container);
}


// Setup function called from script.js
export function setupConceptConstellation(wordInput, exploreButton, visualizationArea) {
    // Add event listener to the button
    exploreButton.addEventListener('click', () => {
        const word = wordInput.value;
        // Initial exploration from input box, clickedNodeId is null
        handleExplore(word, visualizationArea);
    });

    // Optional: Allow pressing Enter in the input field
    wordInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent form submission
            exploreButton.click();
        }
    });

    // Initial state: render the placeholder graphic
    renderGraph(visualizationArea);
}