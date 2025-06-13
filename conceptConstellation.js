// Global graph data structure
let graphData = {
    nodes: [],
    links: []
};

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


// Function to calculate/update node positions based on parent-child relationships
function updateNodePositions(nodes) {
    const centerX = 400;
    const centerY = 250;
    const level1Radius = 200; // Radius for first layer around center
    const childRadius = 100; // Radius for children around their specific parent

    // Ensure center node is positioned
    const centerNode = nodes.find(node => node.isCenter);
    if (centerNode) {
        centerNode.x = centerX;
        centerNode.y = centerY;
    }

    // Group nodes by their parentId
    const nodesByParent = {};
    nodes.forEach(node => {
        if (node.parentId) {
            if (!nodesByParent[node.parentId]) {
                nodesByParent[node.parentId] = [];
            }
            nodesByParent[node.parentId].push(node);
        }
    });

    // Position nodes based on their parent
    for (const parentId in nodesByParent) {
        const children = nodesByParent[parentId];
        const parentNode = nodes.find(node => node.id === parentId);

        if (!parentNode || parentNode.x === undefined || parentNode.y === undefined) {
            console.warn(`Parent node ${parentId} not found or not positioned.`);
            continue;
        }

        const px = parentNode.x;
        const py = parentNode.y;

        // Determine radius for this group of children
        // If parent is the initial center, use level1Radius, otherwise use childRadius
        const currentRadius = parentNode.isCenter ? level1Radius : childRadius;

        children.forEach((child, index) => {
             // Only position if the node hasn't been positioned yet by another parent
             // This prioritizes the position based on the first parent that added it.
             if (child.x === undefined || child.y === undefined) {
                // Calculate angle to position child radially around parent
                // Distribute children evenly in a circle
                const angle = (Math.PI * 2 / children.length) * index;

                child.x = px + currentRadius * Math.cos(angle);
                child.y = py + currentRadius * Math.sin(angle);
             }
        });
    }

    // Optional: Could add logic here to slightly adjust positions to reduce overlap
    // This would require more complex layout algorithms (e.g., force simulation steps)
    // For now, positions are fixed once set by the parent.
}


// Function to render the visualization using SVG
function renderGraph(container) {
    // Clear previous content (SVG and loading overlay)
    container.innerHTML = '';

    if (graphData.nodes.length === 0) {
         // If no nodes exist (e.g., initial state or AI returned nothing for initial search)
         container.innerHTML = `<p class="placeholder">Enter a word above and click 'Explore' to see the concept constellation.</p>`;
         return;
    }

    // Create SVG element
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 800 500"); // Match container size or aspect
    container.appendChild(svg);

    // Calculate positions before rendering
    updateNodePositions(graphData.nodes);

    // Add lines first so nodes are on top
    graphData.links.forEach(link => {
        const sourceNode = graphData.nodes.find(n => n.id === link.source);
        const targetNode = graphData.nodes.find(n => n.id === link.target);

        // Only draw link if both source and target nodes exist and are positioned
        if (!sourceNode || !targetNode || sourceNode.x === undefined || targetNode.x === undefined) {
            console.warn("Could not draw link due to missing node or position:", link);
            return;
        }

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", sourceNode.x);
        line.setAttribute("y1", sourceNode.y);
        line.setAttribute("x2", targetNode.x);
        line.setAttribute("y2", targetNode.y);
        line.classList.add("relation-line");
        svg.appendChild(line);
    });


    // Add nodes
    graphData.nodes.forEach(node => {
        // Only render node if it has been positioned
        if (node.x === undefined || node.y === undefined) {
            console.warn("Node position not set, skipping render:", node);
            return; // Skip rendering nodes without positions
        }
        const nodeGroup = createNode(node.x, node.y, node.text, node.isCenter ? "center-node" : "concept-node");
        svg.appendChild(nodeGroup);

         // Add click listener to all nodes.
         // Clicking any node will explore its related concepts and add them to the graph.
         // Clicking any node will explore its related concepts and add them to the graph.
         nodeGroup._nodeId = node.id; // Store node id for event listener
         nodeGroup.addEventListener('click', (event) => {
             const clickedId = event.currentTarget._nodeId;
             handleExplore(clickedId, container, clickedId); // Explore the clicked word, pass clickedId as source
         });

    });
}

// Helper function to create an SVG node group (circle + text)
function createNode(x, y, text, className) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add(className);
    // The transform attribute positions the group at (x, y)
    group.setAttribute("transform", `translate(${x}, ${y})`);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    // Calculate radius based on text length - crude approximation
    // Max of 25, or 15 + 3px per character length
    const radius = Math.max(25, 15 + (text ? text.length : 0) * 3);

    circle.setAttribute("r", radius);

    const textElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
    textElement.textContent = text;
    // Position text at the center of the circle (which is 0,0 within the group)
    textElement.setAttribute("x", "0");
    textElement.setAttribute("y", "0");
    textElement.setAttribute("dy", "0.35em"); // Adjust for vertical alignment
    textElement.setAttribute("text-anchor", "middle"); // Horizontal alignment
    textElement.style.pointerEvents = "none"; // Ensure text doesn't block clicks on the circle
    textElement.style.userSelect = "none"; // Prevent text selection

    group.appendChild(circle);
    group.appendChild(textElement);

    return group;
}


// Main function to handle exploration or node click
async function handleExplore(word, container, clickedNodeId = null) {
    if (!word || word.trim() === "") {
        if (!clickedNodeId) { // Only clear and show placeholder if not clicking on a node
             graphData.nodes = [];
             graphData.links = [];
             container.innerHTML = '<p class="placeholder">Please enter a word.</p>';
        }
        // If word is empty but a node was clicked, do nothing (shouldn't happen with node IDs)
        return;
    }

    // Add loading indicator
    // Remove any existing loading indicator first
    const existingLoading = container.querySelector('.loading-overlay');
    if(existingLoading) existingLoading.remove();

    const loadingOverlay = document.createElement('div');
    loadingOverlay.classList.add('loading-overlay');
    loadingOverlay.textContent = `Exploring "${word}"...`;
    container.appendChild(loadingOverlay);


    // If it's a new initial exploration from the input box
    if (!clickedNodeId) {
        graphData.nodes = [];
        graphData.links = [];
        // Add the initial node. Position will be set in updateNodePositions.
        graphData.nodes.push({ id: word, text: word, isCenter: true });
    }
    // Note: If clickedNodeId IS provided, we do NOT clear graphData. We add to it.

    // Call AI to get related concepts
    const relatedConcepts = await generateRelatedConcepts(word);

    // Remove loading indicator after AI call
    loadingOverlay.remove();

    // Add new nodes and links to graphData
    relatedConcepts.forEach(concept => {
        const cleanConcept = concept.trim(); // Use trimmed concept for ID and text

        if (!cleanConcept) return; // Skip empty concepts

        // Add node if it doesn't exist
        const existingNode = graphData.nodes.find(n => n.id === cleanConcept);
        if (!existingNode) {
            // Add new node. Position will be calculated by updateNodePositions based on parentId.
            // The parentId is the word we just explored (which is the clickedNodeId if not initial, or the initial word).
             graphData.nodes.push({ id: cleanConcept, text: cleanConcept, parentId: word });
        } else {
             // If the node exists, we could potentially update its parentId list
             // if we wanted to track all parents, but for positioning, the first parentId is used.
             // For now, we just ensure the link exists.
        }

        // Add link if it doesn't exist (check both directions)
        const linkExists = graphData.links.some(link =>
            (link.source === word && link.target === cleanConcept) ||
            (link.source === cleanConcept && link.target === word)
        );

        if (!linkExists) {
            graphData.links.push({ source: word, target: cleanConcept });
        }
    });

    // If no new concepts were added AND it was a click on an existing node, provide feedback?
    // This is hard to check precisely without comparing old/new graph states.
    // For now, rely on console log and the graph simply not changing visibly.

    // Render the updated graph
    renderGraph(container);
}


// Setup function called from index.js
export function setupConceptConstellation(wordInput, exploreButton, visualizationArea) {
    // Add event listener to the button
    exploreButton.addEventListener('click', () => {
        const word = wordInput.value;
        handleExplore(word, visualizationArea); // Initial explore, no clickedNodeId
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