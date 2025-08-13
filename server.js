const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname)));

// Lobby management
const lobbies = new Map(); // lobbyCode -> lobby data
const playerSockets = new Map(); // socketId -> player data

// Generate unique 6-digit lobby code
function generateLobbyCode() {
  let code;
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (lobbies.has(code));
  return code;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Create lobby
  socket.on('createLobby', (data) => {
    const { name } = data;
    const lobbyCode = generateLobbyCode();
    const playerId = socket.id;
    
    const lobby = {
      id: lobbyCode,
      players: [{
        id: playerId,
        name: name,
        ready: false
      }],
      maxPlayers: 2
    };
    
    lobbies.set(lobbyCode, lobby);
    playerSockets.set(socket.id, {
      lobbyCode: lobbyCode,
      playerId: playerId,
      name: name
    });
    
    socket.join(lobbyCode);
    socket.emit('lobbyCreated', {
      id: lobbyCode,
      players: lobby.players,
      myId: playerId
    });
    
    console.log(`Lobby ${lobbyCode} created by ${name}`);
  });

  // Join lobby
  socket.on('joinLobby', (data) => {
    const { lobbyCode, name } = data;
    const lobby = lobbies.get(lobbyCode);
    
    if (!lobby) {
      socket.emit('lobbyError', 'Lobby not found');
      return;
    }
    
    if (lobby.players.length >= lobby.maxPlayers) {
      socket.emit('lobbyError', 'Lobby is full');
      return;
    }
    
    const playerId = socket.id;
    const newPlayer = {
      id: playerId,
      name: name,
      ready: false
    };
    
    lobby.players.push(newPlayer);
    playerSockets.set(socket.id, {
      lobbyCode: lobbyCode,
      playerId: playerId,
      name: name
    });
    
    socket.join(lobbyCode);
    socket.emit('lobbyJoined', {
      id: lobbyCode,
      players: lobby.players,
      myId: playerId
    });
    
    // Notify all players in lobby
    io.to(lobbyCode).emit('lobbyUpdate', {
      id: lobbyCode,
      players: lobby.players
    });
    
    console.log(`${name} joined lobby ${lobbyCode}`);
  });

  // Player ready/unready
  socket.on('playerReady', (data) => {
    const { ready } = data;
    const playerData = playerSockets.get(socket.id);
    
    if (!playerData) return;
    
    const lobby = lobbies.get(playerData.lobbyCode);
    if (!lobby) return;
    
    const player = lobby.players.find(p => p.id === playerData.playerId);
    if (player) {
      player.ready = ready;
      
      // Notify all players in lobby
      io.to(playerData.lobbyCode).emit('playerReady', {
        players: lobby.players
      });
      
      // Check if both players are ready and not in game setup mode
      if (lobby.players.length === 2 && lobby.players.every(p => p.ready) && !lobby.inGameSetup) {
        // Start game after a short delay
        setTimeout(() => {
          io.to(playerData.lobbyCode).emit('startGame', {
            lobbyCode: playerData.lobbyCode,
            players: lobby.players
          });
          console.log(`Game starting in lobby ${playerData.lobbyCode}`);
        }, 2000);
      }
    }
  });

  // Player army selection
  socket.on('playerArmySelected', (data) => {
    console.log('🎖️ ===== PLAYER ARMY SELECTED EVENT =====');
    console.log('📥 Received data:', data);
    console.log('📊 armyData received:', data.armyData);
    const { lobbyCode, playerId, armyId, action, armyData } = data;
    console.log('🔍 Parsed data:', { lobbyCode, playerId, armyId, action, armyData });
    
    const playerData = playerSockets.get(socket.id);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) return;
    
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) return;
    
    // Store army selection in lobby data
    if (!lobby.armySelections) {
      lobby.armySelections = {};
    }
    if (!lobby.armySelections[playerId]) {
      lobby.armySelections[playerId] = [];
    }
    
    console.log('🎯 Action type:', action);
    if (action === 'remove') {
      // Remove army from selection
      console.log('🗑️ Processing army removal...');
      const index = lobby.armySelections[playerId].indexOf(armyId);
      console.log('🔍 Army index in array:', index);
      if (index > -1) {
        lobby.armySelections[playerId].splice(index, 1);
        console.log(`✅ Player ${playerId} removed army ${armyId} in lobby ${lobbyCode}`);
      } else {
        console.log(`❌ Army ${armyId} not found in player ${playerId}'s selections`);
      }
    } else {
      // Add army to selection (default action)
      console.log('➕ Processing army addition...');
      if (!lobby.armySelections[playerId].includes(armyId)) {
        lobby.armySelections[playerId].push(armyId);
        console.log(`✅ Player ${playerId} selected army ${armyId} in lobby ${lobbyCode}`);
      } else {
        console.log(`⚠️ Army ${armyId} already selected by player ${playerId}`);
      }
    }
    
    // Map player IDs to player1/player2 for client
    const player1Id = lobby.players[0]?.id;
    const player2Id = lobby.players[1]?.id;
    
    const clientArmySelections = {
      player1: lobby.armySelections[player1Id] || [],
      player2: lobby.armySelections[player2Id] || []
    };
    
    console.log('📤 ===== SENDING PLAYER ARMY SELECTED EVENT =====');
    console.log('🎖️ Player 1 ID:', player1Id);
    console.log('🎖️ Player 2 ID:', player2Id);
    console.log('📊 Lobby army selections:', lobby.armySelections);
    console.log('📊 Client army selections:', clientArmySelections);
    console.log('📤 Emitting playerArmySelected with data:', {
      playerId: playerId,
      armyId: armyId,
      action: action || 'add',
      armySelections: clientArmySelections,
      armyData: armyData
    });
    console.log('📊 armyData being sent:', armyData);
    
    // Notify all players about army selection/removal
    io.to(lobbyCode).emit('playerArmySelected', {
      playerId: playerId,
      armyId: armyId,
      action: action || 'add',
      armySelections: clientArmySelections,
      armyData: armyData // Include the full army data if provided
    });
    
    console.log('✅ playerArmySelected event sent successfully');
    console.log('📤 ===== SENDING PLAYER ARMY SELECTED EVENT COMPLETED =====');
    
    // Also update army selection status based on whether players have armies
    const player1HasArmies = (lobby.armySelections[player1Id] || []).length > 0;
    const player2HasArmies = (lobby.armySelections[player2Id] || []).length > 0;
    
    // Update army selection status for both players
    if (!lobby.armySelectionStatus) {
      lobby.armySelectionStatus = {};
    }
    lobby.armySelectionStatus[player1Id] = player1HasArmies;
    lobby.armySelectionStatus[player2Id] = player2HasArmies;
    
    // Emit army selection status update
    io.to(lobbyCode).emit('armySelectionStatusUpdate', {
      selectionStatus: {
        player1: player1HasArmies,
        player2: player2HasArmies
      }
    });
    
    console.log('Current army selections:', lobby.armySelections);
    console.log('Updated army selection status:', lobby.armySelectionStatus);
    console.log('🎖️ ===== PLAYER ARMY SELECTED EVENT COMPLETED =====');
  });



  // Game setup ready status
  socket.on('gameSetupReadyStatus', (data) => {
    console.log('🎯 ===== GAME SETUP READY STATUS RECEIVED =====');
    console.log('📥 Received data:', data);
    
    const { lobbyCode, playerId, ready } = data;
    const playerData = playerSockets.get(socket.id);
    
    console.log('🔍 Player data:', playerData);
    console.log('🎯 Lobby code match:', playerData?.lobbyCode === lobbyCode);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) {
      console.error('❌ Invalid player data or lobby code mismatch');
      return;
    }
    
    const lobby = lobbies.get(lobbyCode);
    console.log('🔍 Lobby found:', !!lobby);
    
    if (!lobby) {
      console.error('❌ Lobby not found');
      return;
    }
    
    // Store ready status in lobby data
    if (!lobby.gameSetupReadyStatus) {
      lobby.gameSetupReadyStatus = {};
    }
    lobby.gameSetupReadyStatus[playerId] = ready;
    
    console.log('💾 Updated lobby game setup ready status:', lobby.gameSetupReadyStatus);
    
    // Map player IDs to player1/player2 for client
    const player1Id = lobby.players[0]?.id;
    const player2Id = lobby.players[1]?.id;
    
    const clientReadyStatus = {
      player1: lobby.gameSetupReadyStatus[player1Id] || false,
      player2: lobby.gameSetupReadyStatus[player2Id] || false
    };
    
    console.log('📤 Emitting gameSetupReadyStatusUpdate to all players:', {
      playerId: playerId,
      ready: ready,
      readyStatus: clientReadyStatus
    });
    
    // Notify all players about ready status
    io.to(lobbyCode).emit('gameSetupReadyStatusUpdate', {
      playerId: playerId,
      ready: ready,
      readyStatus: clientReadyStatus
    });
    
    console.log(`✅ Player ${playerId} game setup ready status: ${ready} in lobby ${lobbyCode}`);
    console.log('🎯 ===== GAME SETUP READY STATUS PROCESSING COMPLETED =====');
  });

  // Request game setup ready status
  socket.on('requestGameSetupReadyStatus', (data) => {
    console.log('🎯 ===== REQUEST GAME SETUP READY STATUS =====');
    console.log('📥 Received data:', data);
    
    const { lobbyCode } = data;
    const playerData = playerSockets.get(socket.id);
    
    console.log('🔍 Player data:', playerData);
    console.log('🎯 Lobby code match:', playerData?.lobbyCode === lobbyCode);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) {
      console.error('❌ Invalid player data or lobby code mismatch');
      return;
    }
    
    const lobby = lobbies.get(lobbyCode);
    console.log('🔍 Lobby found:', !!lobby);
    
    if (!lobby) {
      console.error('❌ Lobby not found');
      return;
    }
    
    // Map player IDs to player1/player2 for client
    const player1Id = lobby.players[0]?.id;
    const player2Id = lobby.players[1]?.id;
    
    const clientReadyStatus = {
      player1: lobby.gameSetupReadyStatus?.[player1Id] || false,
      player2: lobby.gameSetupReadyStatus?.[player2Id] || false
    };
    
    console.log('📤 Sending game setup ready status to client:', clientReadyStatus);
    
    // Send current ready status to the requesting client
    socket.emit('gameSetupReadyStatusUpdate', {
      readyStatus: clientReadyStatus
    });
    
    console.log('✅ Game setup ready status sent successfully');
    console.log('🎯 ===== REQUEST GAME SETUP READY STATUS COMPLETED =====');
  });

  // Game ready status (legacy - keeping for compatibility)
  socket.on('gameReadyStatus', (data) => {
    console.log('🎮 ===== GAME READY STATUS RECEIVED =====');
    console.log('📥 Received data:', data);
    
    const { lobbyCode, playerId, ready } = data;
    const playerData = playerSockets.get(socket.id);
    
    console.log('🔍 Player data:', playerData);
    console.log('🎯 Lobby code match:', playerData?.lobbyCode === lobbyCode);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) {
      console.error('❌ Invalid player data or lobby code mismatch');
      return;
    }
    
    const lobby = lobbies.get(lobbyCode);
    console.log('🔍 Lobby found:', !!lobby);
    
    if (!lobby) {
      console.error('❌ Lobby not found');
      return;
    }
    
    // Store ready status in lobby data
    if (!lobby.gameReadyStatus) {
      lobby.gameReadyStatus = {};
    }
    lobby.gameReadyStatus[playerId] = ready;
    
    console.log('💾 Updated lobby game ready status:', lobby.gameReadyStatus);
    
    // Map player IDs to player1/player2 for client
    const player1Id = lobby.players[0]?.id;
    const player2Id = lobby.players[1]?.id;
    
    const clientReadyStatus = {
      player1: lobby.gameReadyStatus[player1Id] || false,
      player2: lobby.gameReadyStatus[player2Id] || false
    };
    
    console.log(`Ready status update - Player ${playerId}: ${ready}`);
    console.log(`Lobby players:`, lobby.players.map(p => ({ id: p.id, name: p.name })));
    console.log(`Player1 ID: ${player1Id}, Player2 ID: ${player2Id}`);
    console.log(`Client ready status:`, clientReadyStatus);
    console.log(`Full lobby ready status:`, lobby.gameReadyStatus);
    
    // Notify all players about ready status
    const emitData = {
      playerId: playerId,
      ready: ready,
      readyStatus: clientReadyStatus
    };
    
    console.log('📤 Emitting gameReadyStatusUpdate to all players:', emitData);
    io.to(lobbyCode).emit('gameReadyStatusUpdate', emitData);
    
    console.log(`✅ Player ${playerId} game ready status: ${ready} in lobby ${lobbyCode}`);
    console.log('🎮 ===== GAME READY STATUS PROCESSING COMPLETED =====');
  });

  // Enter game setup mode
  socket.on('enterGameSetup', (data) => {
    console.log('🎮 ===== ENTER GAME SETUP MODE =====');
    console.log('📥 Received data:', data);
    
    const { lobbyCode } = data;
    const playerData = playerSockets.get(socket.id);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) {
      console.error('❌ Invalid player data or lobby code mismatch');
      return;
    }
    
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) {
      console.error('❌ Lobby not found');
      return;
    }
    
    // Set game setup flag
    lobby.inGameSetup = true;
    console.log('✅ Lobby set to game setup mode');
    console.log('🎮 ===== ENTER GAME SETUP MODE COMPLETED =====');
  });

  // Request ready status
  socket.on('requestReadyStatus', (data) => {
    console.log('🎮 ===== REQUEST READY STATUS RECEIVED =====');
    console.log('📥 Received data:', data);
    
    const { lobbyCode } = data;
    const playerData = playerSockets.get(socket.id);
    
    console.log('🔍 Player data:', playerData);
    console.log('🎯 Lobby code match:', playerData?.lobbyCode === lobbyCode);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) {
      console.error('❌ Invalid player data or lobby code mismatch');
      return;
    }
    
    const lobby = lobbies.get(lobbyCode);
    console.log('🔍 Lobby found:', !!lobby);
    
    if (!lobby) {
      console.error('❌ Lobby not found');
      return;
    }
    
    // Map player IDs to player1/player2 for client
    const player1Id = lobby.players[0]?.id;
    const player2Id = lobby.players[1]?.id;
    
    console.log('👥 Player IDs:', { player1Id, player2Id });
    console.log('📊 Current lobby game ready status:', lobby.gameReadyStatus);
    
    const clientReadyStatus = {
      player1: lobby.gameReadyStatus?.[player1Id] || false,
      player2: lobby.gameReadyStatus?.[player2Id] || false
    };
    
    console.log('📤 Sending ready status to client:', clientReadyStatus);
    
    // Send current ready status to the requesting client
    socket.emit('gameReadyStatusUpdate', {
      readyStatus: clientReadyStatus
    });
    
    console.log('✅ Ready status sent successfully');
    console.log('🎮 ===== REQUEST READY STATUS COMPLETED =====');
  });

  // Start multiplayer game
  socket.on('startMultiplayerGame', (data) => {
    const { lobbyCode, gameConfig } = data;
    const playerData = playerSockets.get(socket.id);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) return;
    
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) return;
    
    // Verify this is the host (first player)
    const isHost = lobby.players.indexOf(lobby.players.find(p => p.id === playerData.playerId)) === 0;
    if (!isHost) {
      socket.emit('lobbyError', 'Only the host can start the game');
      return;
    }
    
    // Check if both players have selected armies
    const player1Id = lobby.players[0]?.id;
    const player2Id = lobby.players[1]?.id;
    const bothSelectedArmies = lobby.armySelectionStatus && 
                              lobby.armySelectionStatus[player1Id] && 
                              lobby.armySelectionStatus[player2Id];
    
    if (!bothSelectedArmies) {
      socket.emit('lobbyError', 'Both players must select armies before starting the game');
      return;
    }
    
    // Store game configuration
    lobby.gameConfig = gameConfig;
    
    // Notify all players that game is starting
    io.to(lobbyCode).emit('multiplayerGameStarted', {
      lobbyCode: lobbyCode,
      gameConfig: gameConfig,
      players: lobby.players
    });
    
    // Store initial game state in lobby for synchronization
    lobby.gameState = null; // Will be set by the first player
    lobby.zones = null; // Will be set by the first player
    
    console.log(`Multiplayer game started in lobby ${lobbyCode}`);
  });

  // Leave lobby
  socket.on('leaveLobby', () => {
    const playerData = playerSockets.get(socket.id);
    if (!playerData) return;
    
    const lobby = lobbies.get(playerData.lobbyCode);
    if (lobby) {
      // Remove player from lobby
      lobby.players = lobby.players.filter(p => p.id !== playerData.playerId);
      
      // If lobby is empty, delete it
      if (lobby.players.length === 0) {
        lobbies.delete(playerData.lobbyCode);
        console.log(`Lobby ${playerData.lobbyCode} deleted (empty)`);
      } else {
        // Notify remaining players
        io.to(playerData.lobbyCode).emit('lobbyUpdate', {
          id: playerData.lobbyCode,
          players: lobby.players
        });
      }
    }
    
    socket.leave(playerData.lobbyCode);
    playerSockets.delete(socket.id);
    console.log(`${playerData.name} left lobby ${playerData.lobbyCode}`);
  });

  // Debug event to test if server is receiving events
  socket.on('debug', (data) => {
    console.log('🔍 DEBUG EVENT RECEIVED:', data);
  });

  // Army selection status
  socket.on('armySelectionStatus', (data) => {
    console.log('🎖️ ===== ARMY SELECTION STATUS RECEIVED =====');
    console.log('🎖️ EVENT RECEIVED - armySelectionStatus');
    console.log('📥 Received data:', data);
    
    const { lobbyCode, playerId, armySelected } = data;
    const playerData = playerSockets.get(socket.id);
    
    console.log('🔍 Player data:', playerData);
    console.log('🎯 Lobby code match:', playerData?.lobbyCode === lobbyCode);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) {
      console.error('❌ Invalid player data or lobby code mismatch');
      return;
    }
    
    const lobby = lobbies.get(lobbyCode);
    console.log('🔍 Lobby found:', !!lobby);
    
    if (!lobby) {
      console.error('❌ Lobby not found');
      return;
    }
    
    // Store army selection status in lobby data
    if (!lobby.armySelectionStatus) {
      lobby.armySelectionStatus = {};
    }
    lobby.armySelectionStatus[playerId] = armySelected;
    
    console.log('💾 Updated lobby army selection status:', lobby.armySelectionStatus);
    
    // Map player IDs to player1/player2 for client
    const player1Id = lobby.players[0]?.id;
    const player2Id = lobby.players[1]?.id;
    
    const clientSelectionStatus = {
      player1: lobby.armySelectionStatus[player1Id] || false,
      player2: lobby.armySelectionStatus[player2Id] || false
    };
    
    console.log('📤 Emitting armySelectionStatusUpdate to all players:', {
      playerId: playerId,
      armySelected: armySelected,
      selectionStatus: clientSelectionStatus
    });
    
    // Notify all players about army selection status
    io.to(lobbyCode).emit('armySelectionStatusUpdate', {
      playerId: playerId,
      armySelected: armySelected,
      selectionStatus: clientSelectionStatus
    });
    
    console.log(`✅ Player ${playerId} army selection status: ${armySelected} in lobby ${lobbyCode}`);
    console.log('🎖️ ===== ARMY SELECTION STATUS PROCESSING COMPLETED =====');
  });

  // Multiplayer game synchronization handlers
  socket.on('gameStateUpdate', (data) => {
    const { lobbyCode, gameState, zones } = data;
    const playerData = playerSockets.get(socket.id);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) return;
    
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) return;
    
    // Store the game state in the lobby
    lobby.gameState = gameState;
    lobby.zones = zones;
    
    // Broadcast to all other players in the lobby
    socket.to(lobbyCode).emit('gameStateUpdate', {
      gameState: gameState,
      zones: zones
    });
  });

  socket.on('battlefieldUpdate', (data) => {
    const { lobbyCode, zones, gameState } = data;
    const playerData = playerSockets.get(socket.id);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) return;
    
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) return;
    
    // Store the battlefield state in the lobby
    lobby.zones = zones;
    if (gameState) lobby.gameState = gameState;
    
    // Broadcast to all other players in the lobby
    socket.to(lobbyCode).emit('battlefieldUpdate', {
      zones: zones,
      gameState: gameState
    });
  });

  socket.on('zoneBattleUpdate', (data) => {
    const { lobbyCode, currentZoneDetail, gameState } = data;
    const playerData = playerSockets.get(socket.id);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) return;
    
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) return;
    
    // Store the zone battle state in the lobby
    lobby.currentZoneDetail = currentZoneDetail;
    if (gameState) lobby.gameState = gameState;
    
    // Broadcast to all other players in the lobby
    socket.to(lobbyCode).emit('zoneBattleUpdate', {
      currentZoneDetail: currentZoneDetail,
      gameState: gameState
    });
  });

  socket.on('turnChange', (data) => {
    const { lobbyCode, currentPlayer, commandPoints } = data;
    const playerData = playerSockets.get(socket.id);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) return;
    
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) return;
    
    // Store the turn state in the lobby
    if (lobby.gameState) {
      lobby.gameState.currentPlayer = currentPlayer;
      lobby.gameState.commandPoints = commandPoints;
    }
    
    // Broadcast to all other players in the lobby
    socket.to(lobbyCode).emit('turnChange', {
      currentPlayer: currentPlayer,
      commandPoints: commandPoints
    });
  });



  // Request army selection status
  socket.on('requestArmySelectionStatus', (data) => {
    console.log('🎖️ ===== REQUEST ARMY SELECTION STATUS =====');
    console.log('📥 Received data:', data);
    
    const { lobbyCode } = data;
    const playerData = playerSockets.get(socket.id);
    
    console.log('🔍 Player data:', playerData);
    console.log('🎯 Lobby code match:', playerData?.lobbyCode === lobbyCode);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) {
      console.error('❌ Invalid player data or lobby code mismatch');
      return;
    }
    
    const lobby = lobbies.get(lobbyCode);
    console.log('🔍 Lobby found:', !!lobby);
    
    if (!lobby) {
      console.error('❌ Lobby not found');
      return;
    }
    
    // Map player IDs to player1/player2 for client
    const player1Id = lobby.players[0]?.id;
    const player2Id = lobby.players[1]?.id;
    
    const clientSelectionStatus = {
      player1: lobby.armySelectionStatus?.[player1Id] || false,
      player2: lobby.armySelectionStatus?.[player2Id] || false
    };
    
    console.log('📤 Sending army selection status to client:', clientSelectionStatus);
    
    // Send current army selection status to the requesting client
    socket.emit('armySelectionStatusUpdate', {
      selectionStatus: clientSelectionStatus
    });
    
    console.log('✅ Army selection status sent successfully');
    console.log('🎖️ ===== REQUEST ARMY SELECTION STATUS COMPLETED =====');
  });

  // Player surrender event
  socket.on('playerSurrender', (data) => {
    console.log('🏳️ ===== PLAYER SURRENDER =====');
    console.log('📥 Received surrender data:', data);
    console.log('🏳️ Socket ID:', socket.id);
    console.log('🏳️ Player data:', playerSockets.get(socket.id));
    
    const { lobbyCode, surrenderingPlayer, gameState } = data;
    const playerData = playerSockets.get(socket.id);
    
    console.log('🏳️ Lobby code from data:', lobbyCode);
    console.log('🏳️ Surrendering player:', surrenderingPlayer);
    console.log('🏳️ Player data lobby code:', playerData?.lobbyCode);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) {
      console.error('❌ Invalid player data or lobby code mismatch');
      console.error('❌ Player data:', playerData);
      console.error('❌ Expected lobby code:', lobbyCode);
      return;
    }
    
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) {
      console.error('❌ Lobby not found');
      console.error('❌ Available lobbies:', Array.from(lobbies.keys()));
      return;
    }
    
    console.log('🏳️ Found lobby:', lobby);
    console.log('🏳️ Lobby players:', lobby.players);
    
    // Determine winner based on who surrendered
    const winner = surrenderingPlayer === 'player1' ? 'player2' : 'player1';
    const winnerName = surrenderingPlayer === 'player1' ? 
      lobby.players[1]?.name : lobby.players[0]?.name;
    
    const surrenderData = {
      surrenderingPlayer: surrenderingPlayer,
      winner: winner,
      winnerName: winnerName,
      gameState: gameState
    };
    
    console.log('📤 Broadcasting surrender to all players in lobby');
    console.log('🏆 Winner:', winnerName);
    console.log('🏳️ Surrender data to broadcast:', surrenderData);
    
    // Broadcast surrender to all players in the lobby
    io.to(lobbyCode).emit('gameSurrender', surrenderData);
    
    console.log('✅ Surrender broadcast completed');
    console.log('🏳️ ===== PLAYER SURRENDER COMPLETED =====');
  });

  // Leave lobby event
  socket.on('leaveLobby', (data) => {
    console.log('🚪 ===== PLAYER LEAVE LOBBY =====');
    console.log('📥 Received leave lobby data:', data);
    
    // Handle case where data is undefined (client disconnect)
    if (!data) {
      console.log('🚪 No data provided - likely client disconnect');
      const playerData = playerSockets.get(socket.id);
      if (playerData && playerData.lobbyCode) {
        const lobby = lobbies.get(playerData.lobbyCode);
        if (lobby) {
          // Remove player from lobby
          lobby.players = lobby.players.filter(p => p.id !== playerData.playerId);
          
          // Delete lobby if empty
          if (lobby.players.length === 0) {
            console.log(`Lobby ${playerData.lobbyCode} deleted (disconnect)`);
            lobbies.delete(playerData.lobbyCode);
          } else {
            // Notify remaining players
            io.to(playerData.lobbyCode).emit('playerLeft', {
              playerId: playerData.playerId,
              remainingPlayers: lobby.players
            });
          }
        }
      }
      return;
    }
    
    const { lobbyCode } = data;
    const playerData = playerSockets.get(socket.id);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) {
      console.error('❌ Invalid player data or lobby code mismatch');
      return;
    }
    
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) {
      console.error('❌ Lobby not found');
      return;
    }
    
    console.log('🚪 Player leaving lobby:', playerData.name);
    
    // Remove player from lobby
    lobby.players = lobby.players.filter(p => p.id !== playerData.playerId);
    
    // If lobby is empty, delete it
    if (lobby.players.length === 0) {
      lobbies.delete(lobbyCode);
      console.log(`🚪 Lobby ${lobbyCode} deleted (all players left)`);
    } else {
      // Notify remaining players
      io.to(lobbyCode).emit('lobbyUpdate', {
        id: lobbyCode,
        players: lobby.players
      });
      console.log(`🚪 Remaining players in lobby ${lobbyCode}:`, lobby.players.length);
    }
    
    // Remove player from socket tracking
    playerSockets.delete(socket.id);
    
    console.log('✅ Player left lobby successfully');
    console.log('🚪 ===== PLAYER LEAVE LOBBY COMPLETED =====');
  });

  // Clear army selections event
  socket.on('clearArmySelections', (data) => {
    console.log('🧹 ===== CLEAR ARMY SELECTIONS =====');
    console.log('📥 Received clear army selections data:', data);
    
    const { lobbyCode } = data;
    const playerData = playerSockets.get(socket.id);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) {
      console.error('❌ Invalid player data or lobby code mismatch');
      return;
    }
    
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) {
      console.error('❌ Lobby not found');
      return;
    }
    
    console.log('🧹 Clearing army selections for lobby:', lobbyCode);
    
    // Clear army selections
    lobby.armySelections = {};
    lobby.armySelectionStatus = {};
    
    // Notify all players in the lobby
    io.to(lobbyCode).emit('armySelectionsCleared', {
      lobbyCode: lobbyCode
    });
    
    console.log('✅ Army selections cleared successfully');
    console.log('🧹 ===== CLEAR ARMY SELECTIONS COMPLETED =====');
  });

  // New game request event
  socket.on('requestNewGame', (data) => {
    console.log('🔄 ===== NEW GAME REQUEST =====');
    console.log('📥 Received new game request data:', data);
    
    const { lobbyCode } = data;
    const playerData = playerSockets.get(socket.id);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) {
      console.error('❌ Invalid player data or lobby code mismatch');
      return;
    }
    
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) {
      console.error('❌ Lobby not found');
      return;
    }
    
    console.log('🔄 Player requesting new game:', playerData.name);
    
    // Initialize new game requests if not exists
    if (!lobby.newGameRequests) {
      lobby.newGameRequests = {};
    }
    
    // Mark this player as requesting new game
    lobby.newGameRequests[playerData.playerId] = true;
    
    console.log('🔄 Current new game requests:', lobby.newGameRequests);
    
    // Check if both players have requested new game
    const allPlayersRequested = lobby.players.every(player => 
      lobby.newGameRequests[player.id]
    );
    
    if (allPlayersRequested) {
      console.log('✅ Both players requested new game - proceeding with reset');
      
      // Clear army selections
      lobby.armySelections = {};
      lobby.armySelectionStatus = {};
      
      // Clear new game requests
      lobby.newGameRequests = {};
      
      // Notify all players that new game is starting
      io.to(lobbyCode).emit('newGameStarted', {
        lobbyCode: lobbyCode
      });
      
      console.log('✅ New game started successfully');
    } else {
      console.log('⏳ Waiting for other player to request new game');
      
      // Notify all players about the pending request
      io.to(lobbyCode).emit('newGameRequested', {
        lobbyCode: lobbyCode,
        requestingPlayer: playerData.name,
        pendingRequests: Object.keys(lobby.newGameRequests).length,
        totalPlayers: lobby.players.length
      });
    }
    
    console.log('🔄 ===== NEW GAME REQUEST COMPLETED =====');
  });
  
  // Test event handler
  socket.on('testVictory', (data) => {
    console.log('🧪 ===== TEST VICTORY EVENT =====');
    console.log('📥 Received test victory data:', data);
    console.log('🧪 Socket ID:', socket.id);
    console.log('🧪 ===== TEST VICTORY COMPLETED =====');
  });

  // Handle player name and color updates
  socket.on('playerNameColorUpdate', (data) => {
    console.log('🎨 ===== PLAYER NAME/COLOR UPDATE =====');
    console.log('📥 Received name/color update data:', data);
    
    const { lobbyCode, playerId, field, value } = data;
    const playerData = playerSockets.get(socket.id);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) {
      console.error('❌ Invalid player data or lobby code mismatch');
      return;
    }
    
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) {
      console.error('❌ Lobby not found');
      return;
    }
    
    // Initialize player settings if not exists
    if (!lobby.playerSettings) {
      lobby.playerSettings = {};
    }
    
    // Update the specific field
    lobby.playerSettings[field] = value;
    
    console.log('🎨 Updated player settings:', lobby.playerSettings);
    
    // Broadcast the update to all players in the lobby
    io.to(lobbyCode).emit('playerNameColorUpdate', {
      lobbyCode: lobbyCode,
      field: field,
      value: value,
      updatedBy: playerId
    });
    
    console.log('🎨 ===== PLAYER NAME/COLOR UPDATE COMPLETED =====');
  });

  // Handle victory acceptance
  socket.on('acceptVictory', (data) => {
    console.log('🏆 ===== VICTORY ACCEPTANCE =====');
    console.log('📥 Received victory acceptance data:', data);
    
    const { lobbyCode, playerId, accepted } = data;
    const playerData = playerSockets.get(socket.id);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) {
      console.error('❌ Invalid player data or lobby code mismatch');
      return;
    }
    
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) {
      console.error('❌ Lobby not found');
      return;
    }
    
    // Initialize victory acceptance tracking if not exists
    if (!lobby.victoryAcceptances) {
      lobby.victoryAcceptances = {};
    }
    
    // Mark this player as having accepted
    lobby.victoryAcceptances[playerId] = accepted;
    
    console.log('🏆 Updated victory acceptances:', lobby.victoryAcceptances);
    
    // Check if all players have accepted
    const allPlayersAccepted = lobby.players.every(player => 
      lobby.victoryAcceptances[player.id] === true
    );
    
    if (allPlayersAccepted) {
      console.log('🏆 All players accepted victory - proceeding to summary');
      
      // Broadcast that all players accepted
      io.to(lobbyCode).emit('victoryAccepted', {
        lobbyCode: lobbyCode,
        allAccepted: true
      });
      
      // Clear victory acceptance tracking
      lobby.victoryAcceptances = {};
    } else {
      console.log('🏆 Not all players have accepted yet');
      
      // Broadcast individual acceptance
      io.to(lobbyCode).emit('victoryAcceptanceUpdate', {
        lobbyCode: lobbyCode,
        playerId: playerId,
        accepted: accepted,
        acceptances: lobby.victoryAcceptances
      });
    }
    
    console.log('🏆 ===== VICTORY ACCEPTANCE COMPLETED =====');
  });

  // Handle game victory events
  socket.on('gameVictory', (data) => {
    console.log('🏆 ===== GAME VICTORY =====');
    console.log('📥 Received game victory data:', data);
    console.log('🏆 Socket ID:', socket.id);
    console.log('🏆 Player data:', playerSockets.get(socket.id));
    
    const { lobbyCode, winner, winnerName, endCondition, gameState, zones } = data;
    const playerData = playerSockets.get(socket.id);
    
    if (!playerData || playerData.lobbyCode !== lobbyCode) {
      console.error('❌ Invalid player data or lobby code mismatch');
      return;
    }
    
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) {
      console.error('❌ Lobby not found');
      return;
    }
    
    // Update lobby state with the victory data
    if (gameState) {
      lobby.gameState = gameState;
    }
    if (zones) {
      lobby.zones = zones;
      console.log('🏆 Updated lobby zones with victory state');
    }
    
    console.log('🏆 Broadcasting victory to all players in lobby');
    
    // Broadcast victory to all players in the lobby
    io.to(lobbyCode).emit('gameVictory', {
      lobbyCode: lobbyCode,
      winner: winner,
      winnerName: winnerName,
      endCondition: endCondition,
      gameState: gameState,
      zones: zones // Include the zones from the victory event
    });
    
    console.log('✅ Victory broadcast completed');
    console.log('🏆 ===== GAME VICTORY COMPLETED =====');
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    const playerData = playerSockets.get(socket.id);
    if (playerData) {
      const lobby = lobbies.get(playerData.lobbyCode);
      if (lobby) {
        // Remove player from lobby
        lobby.players = lobby.players.filter(p => p.id !== playerData.playerId);
        
        // If lobby is empty, delete it
        if (lobby.players.length === 0) {
          lobbies.delete(playerData.lobbyCode);
          console.log(`Lobby ${playerData.lobbyCode} deleted (disconnect)`);
        } else {
          // Notify remaining players
          io.to(playerData.lobbyCode).emit('lobbyUpdate', {
            id: playerData.lobbyCode,
            players: lobby.players
          });
        }
      }
      
      playerSockets.delete(socket.id);
      console.log(`${playerData.name} disconnected from lobby ${playerData.lobbyCode}`);
    }
  });
});

// Root route - serve the main game
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'ww1game.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    lobbies: lobbies.size,
    players: playerSockets.size
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎖️ Multiplayer game server running on port ${PORT}`);
  console.log(`🎖️ Army selection system enabled`);
  console.log(`Open http://localhost:${PORT}/ww1game.html in your browser`);
}); 