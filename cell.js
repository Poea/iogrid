var rbush = require('rbush');
var SAT = require('sat');
var CoinManager = require('./coin-manager').CoinManager;

var STALE_TIMEOUT = 1000;

var options;
var coinManager;

module.exports.init = function(opts) {
  options = opts;
  // coinManager = new CoinManager({
  //   serverWorkerId: serverWorkerId,
  //   worldWidth: WORLD_WIDTH,
  //   worldHeight: WORLD_HEIGHT,
  //   maxCoinCount: COIN_MAX_COUNT,
  //   playerNoDropRadius: COIN_PLAYER_NO_DROP_RADIUS,
  //   players: game.players
  // });
};

module.exports.run = function (cellData, done) {
  var self = this;

  var players = cellData.player || {};
  var processedSubtree = {
    player: {}
  };

  removeStalePlayers(players, processedSubtree);
  findPlayerOverlaps(players, processedSubtree);
  applyPlayerOps(players, processedSubtree);

  done(processedSubtree);
};

function applyPlayerOps(players, processedSubtree) {
  var playerIds = Object.keys(players);
  playerIds.forEach(function (playerId) {
    var player = players[playerId];

    // The isFresh property tells us whether or not this
    // state was updated in this iteration of the cell controller.
    // If it hasn't been updated in this iteration, then we don't need
    // to process it again.
    if (player.isFresh) {
      var playerOp = player.op;
      var moveSpeed;
      if (player.subtype == 'bot') {
        moveSpeed = player.speed;
      } else {
        moveSpeed = options.playerMoveSpeed;
      }
      if (player.data) {
        if (player.data.score) {
          player.score = player.data.score;
        }
      }

      if (playerOp) {
        var movementVector = {x: 0, y: 0};

        if (playerOp.u) {
          movementVector.y = -moveSpeed;
        }
        if (playerOp.d) {
          movementVector.y = moveSpeed;
        }
        if (playerOp.r) {
          movementVector.x = moveSpeed;
        }
        if (playerOp.l) {
          movementVector.x = -moveSpeed;
        }

        player.x += movementVector.x;
        player.y += movementVector.y;

        processedSubtree.player[player.id] = player;
      }

      var halfWidth = Math.round(player.width / 2);
      var halfHeight = Math.round(player.height / 2);

      var leftX = player.x - halfWidth;
      var rightX = player.x + halfWidth;
      var topY = player.y - halfHeight;
      var bottomY = player.y + halfHeight;

      if (leftX < 0) {
        player.x = halfWidth;
      } else if (rightX > options.worldWidth) {
        player.x = options.worldWidth - halfWidth;
      }
      if (topY < 0) {
        player.y = halfHeight;
      } else if (bottomY > options.worldHeight) {
        player.y = options.worldHeight - halfHeight;
      }
    }

    if (player.overlaps) {
      player.overlaps.forEach(function (otherPlayer) {
        resolveCollision(player, otherPlayer, processedSubtree);
      });
      delete player.overlaps;
    }
  });
}

function removeStalePlayers(players) {
  var playerIds = Object.keys(players);
  playerIds.forEach(function (playerId) {
    var player = players[playerId];
    if (player.delete || Date.now() - player.processed > STALE_TIMEOUT) {
      delete players[playerId];
    }
  });
}

function findPlayerOverlaps(players) {
  var playerIds = Object.keys(players);
  var playerTree = new rbush();
  var hitAreaList = [];

  playerIds.forEach(function (playerId) {
    var player = players[playerId];
    player.hitArea = generateHitArea(player);
    hitAreaList.push(player.hitArea);
  });

  playerTree.load(hitAreaList);

  playerIds.forEach(function (playerId) {
    var player = players[playerId];
    playerTree.remove(player.hitArea);
    var hitList = playerTree.search(player.hitArea);
    playerTree.insert(player.hitArea);

    hitList.forEach(function (hit) {
      if (!player.overlaps) {
        player.overlaps = [];
      }
      player.overlaps.push(hit.player);
    });
  });

  playerIds.forEach(function (playerId) {
    delete players[playerId].hitArea;
  });
}

function generateHitArea(player) {
  var playerRadius = Math.round(player.width / 2);
  return {
    player: player,
    minX: player.x - playerRadius,
    minY: player.y - playerRadius,
    maxX: player.x + playerRadius,
    maxY: player.y + playerRadius
  };
}

function resolveCollision(player, otherPlayer, processedSubtree) {
  var currentUser = new SAT.Circle(new SAT.Vector(player.x, player.y), Math.round(player.width / 2));
  var otherUser = new SAT.Circle(new SAT.Vector(otherPlayer.x, otherPlayer.y), Math.round(otherPlayer.width / 2));
  var response = new SAT.Response();
  var collided = SAT.testCircleCircle(currentUser, otherUser, response);

  if (collided) {
    var olv = response.overlapV;

    var totalMass = player.mass + otherPlayer.mass;
    var playerBuff = player.mass / totalMass;
    var otherPlayerBuff = otherPlayer.mass / totalMass;

    player.x -= olv.x * otherPlayerBuff;
    player.y -= olv.y * otherPlayerBuff;
    otherPlayer.x += olv.x * playerBuff;
    otherPlayer.y += olv.y * playerBuff;

    processedSubtree.player[player.id] = player;
    processedSubtree.player[otherPlayer.id] = otherPlayer;
  }
}
