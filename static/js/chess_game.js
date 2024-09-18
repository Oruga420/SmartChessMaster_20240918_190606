console.log('PIECE_THEME:', PIECE_THEME);

const socket = io();
let board;
let game;
let currentPlayer = 'white';

function onDragStart(source, piece, position, orientation) {
    if (game.game_over()) return false;

    if ((currentPlayer === 'white' && piece.search(/^b/) !== -1) ||
        (currentPlayer === 'black' && piece.search(/^w/) !== -1)) {
        return false;
    }

    if (currentPlayer === 'black') return false;
}

function onDrop(source, target) {
    const sourceRank = parseInt(source[1]);
    const targetRank = parseInt(target[1]);
    const piece = game.get(source);
    
    if (piece && piece.type === 'p' && ((piece.color === 'w' && targetRank === 8) || (piece.color === 'b' && targetRank === 1))) {
        const promotionPiece = prompt("Choose promotion piece: q (Queen), r (Rook), b (Bishop), n (Knight)", "q");
        if (!['q', 'r', 'b', 'n'].includes(promotionPiece)) {
            return 'snapback';
        }
        const move = game.move({
            from: source,
            to: target,
            promotion: promotionPiece
        });
        if (move === null) return 'snapback';
    } else {
        const move = game.move({
            from: source,
            to: target,
            promotion: 'q'
        });
        if (move === null) return 'snapback';
    }

    socket.emit('move', { move: source + target });
    updateStatus();
    updateCapturedPieces();
}

function onSnapEnd() {
    board.position(game.fen());
}

function updateStatus() {
    let status = '';

    if (game.in_checkmate()) {
        status = game.turn() === 'w' ? 'Game over, Black wins by checkmate' : 'Game over, White wins by checkmate';
    } else if (game.in_draw()) {
        status = 'Game over, drawn position';
    } else {
        let moveColor = game.turn() === 'w' ? 'White' : 'Black';
        status = moveColor + ' to move';
        if (game.in_check()) {
            status += ', ' + moveColor + ' is in check';
        }
    }

    document.getElementById('status').innerHTML = status;
}

function highlightLegalMoves(square) {
    console.log('Highlighting legal moves for square:', square);
    const moves = game.moves({
        square: square,
        verbose: true
    });

    moves.forEach(move => {
        console.log('Legal move:', move.to);
        document.querySelector(`.square-${move.to}`).classList.add('highlight-legal');
    });
}

function removeHighlights() {
    document.querySelectorAll('.highlight-legal').forEach(el => {
        el.classList.remove('highlight-legal');
    });
}

function preloadImages() {
    const pieces = ['wP', 'wR', 'wN', 'wB', 'wQ', 'wK', 'bP', 'bR', 'bN', 'bB', 'bQ', 'bK'];
    pieces.forEach(piece => {
        const img = new Image();
        img.onload = () => console.log(`Loaded: ${piece}, URL: ${img.src}`);
        img.onerror = (error) => {
            console.error(`Failed to load: ${piece}, URL: ${img.src}`);
            console.error('Error details:', error);
        };
        img.src = PIECE_THEME + piece + '.svg';
    });
}

function updateCapturedPieces() {
    const whiteCaptured = [];
    const blackCaptured = [];

    const pieceValues = {
        'p': 1, 'n': 3, 'b': 3, 'r': 5, 'q': 9
    };

    for (let i = 0; i < game.history().length; i++) {
        const move = game.history()[i];
        if (move.includes('x')) {
            const capturedPiece = game.history()[i].charAt(game.history()[i].indexOf('x') + 1).toLowerCase();
            if (i % 2 === 0) {
                blackCaptured.push(capturedPiece);
            } else {
                whiteCaptured.push(capturedPiece);
            }
        }
    }

    function sortPieces(pieces) {
        return pieces.sort((a, b) => pieceValues[b] - pieceValues[a]);
    }

    const whiteCapturedSorted = sortPieces(whiteCaptured);
    const blackCapturedSorted = sortPieces(blackCaptured);

    function displayCapturedPieces(pieces, containerId) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        pieces.forEach(piece => {
            const img = document.createElement('img');
            img.src = PIECE_THEME + (containerId === 'white-captured' ? 'b' : 'w') + piece.toUpperCase() + '.svg';
            img.alt = piece;
            img.width = 30;
            img.height = 30;
            container.appendChild(img);
        });
    }

    displayCapturedPieces(whiteCapturedSorted, 'white-captured');
    displayCapturedPieces(blackCapturedSorted, 'black-captured');
}

function setDifficulty(difficulty) {
    fetch('/set_difficulty', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ difficulty: difficulty }),
    })
    .then(response => response.json())
    .then(data => {
        console.log('Difficulty set:', data);
        alert(`AI difficulty set to ${difficulty}`);
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    preloadImages();

    const config = {
        draggable: true,
        position: 'start',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd,
        onMouseoutSquare: removeHighlights,
        onMouseoverSquare: (square, piece) => {
            console.log('Mouse over square:', square, 'Piece:', piece);
            removeHighlights();
            highlightLegalMoves(square);
        },
        pieceTheme: (piece) => {
            const url = PIECE_THEME + piece + '.svg';
            console.log('Loading piece:', piece, 'URL:', url);
            return url;
        }
    };

    board = Chessboard('board', config);
    game = new Chess();

    socket.on('update_board', (fen) => {
        game.load(fen);
        board.position(fen);
        updateStatus();
        updateCapturedPieces();
        currentPlayer = game.turn() === 'w' ? 'white' : 'black';
    });

    socket.on('update_clock', (clock) => {
        document.getElementById('white-clock').textContent = formatTime(clock.white);
        document.getElementById('black-clock').textContent = formatTime(clock.black);
    });

    socket.on('strategy_suggestion', (suggestion) => {
        document.getElementById('strategy').textContent = suggestion;
    });

    socket.on('game_over', (data) => {
        let message = '';
        if (data.winner === 'Draw') {
            message = 'Game over! It\'s a draw!';
        } else {
            message = `Game over! ${data.winner} wins!`;
            if (data.ai_surrender) {
                message += ' The AI has no legal moves left and surrenders.';
            }
        }
        alert(message);
        board.draggable = false;
    });

    document.getElementById('reset-btn').addEventListener('click', () => {
        socket.emit('reset_game');
    });

    document.getElementById('difficulty-select').addEventListener('change', (event) => {
        setDifficulty(event.target.value);
    });

    setInterval(() => {
        socket.emit('clock_tick');
    }, 1000);
});

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
