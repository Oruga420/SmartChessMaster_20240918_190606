import time
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import chess
import random
import openai
from io import BytesIO
from PIL import Image
import base64

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app)

if 'OPENAI_API_KEY' not in app.config:
    print("Warning: OPENAI_API_KEY is not set in the application configuration.")

# Global variables
game = chess.Board()
clock = {'white': 600, 'black': 600}  # 10 minutes per player
current_player = 'white'
difficulty = 'medium'  # Default difficulty

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    emit('update_board', game.fen())
    emit('update_clock', clock)

def get_ai_move():
    global difficulty
    try:
        board_fen = game.fen()
        fen_bytes = board_fen.encode('utf-8')
        fen_base64 = base64.b64encode(fen_bytes).decode('utf-8')

        print(f"AI: Analyzing current board position... (Difficulty: {difficulty})")
        openai.api_key = app.config['OPENAI_API_KEY']
        
        # Adjust the prompt based on difficulty
        if difficulty == 'easy':
            difficulty_prompt = "You are a beginner chess player. Make a valid move, but don't try too hard to win."
        elif difficulty == 'medium':
            difficulty_prompt = "You are an intermediate chess player. Make a reasonable move, but occasional mistakes are okay."
        else:  # hard
            difficulty_prompt = "You are an expert chess player. Make the best possible move to win the game."

        response = openai.ChatCompletion.create(
            model="gpt-4-vision-preview",
            messages=[
                {
                    "role": "system",
                    "content": f"You are a chess AI. {difficulty_prompt}"
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": f"Here's the current chess position in FEN format: {board_fen}. What's the best move for the current player?"},
                        {"type": "image_url", "image_url": f"data:image/png;base64,{fen_base64}"}
                    ]
                }
            ]
        )

        ai_move = response.choices[0].message['content'].strip()
        print(f"AI: Thinking about the move: {ai_move}")

        try:
            move = chess.Move.from_uci(ai_move)
            if move in game.legal_moves:
                if game.piece_at(move.from_square).piece_type == chess.PAWN:
                    if (game.turn == chess.WHITE and move.to_square // 8 == 7) or (game.turn == chess.BLACK and move.to_square // 8 == 0):
                        move = chess.Move(move.from_square, move.to_square, promotion=chess.QUEEN)
                
                print(f"AI: Decided to play: {move}")
                return move
            else:
                raise ValueError("Invalid move")
        except ValueError:
            move = random.choice(list(game.legal_moves))
            print(f"AI: Decided to play random move: {move}")
            return move
        
    except Exception as e:
        print(f"Error in get_ai_move: {str(e)}")
        move = random.choice(list(game.legal_moves))
        print(f"AI: Decided to play random move due to error: {move}")
        return move

@socketio.on('move')
def handle_move(data):
    global current_player
    move = chess.Move.from_uci(data['move'])
    if move in game.legal_moves:
        game.push(move)
        current_player = 'black' if current_player == 'white' else 'white'
        emit('update_board', game.fen(), broadcast=True)
        emit('update_clock', clock, broadcast=True)
        emit('strategy_suggestion', get_strategy_suggestion(), broadcast=True)
        
        if game.is_game_over():
            result = game.result()
            winner = 'White' if result == '1-0' else 'Black' if result == '0-1' else 'Draw'
            if game.is_checkmate() and current_player == 'black':
                ai_surrender = analyze_ai_options()
                emit('game_over', {'winner': winner, 'ai_surrender': ai_surrender}, broadcast=True)
            else:
                emit('game_over', {'winner': winner}, broadcast=True)
            return

        if current_player == 'black':
            print("AI's turn to move...")
            time.sleep(2)
            ai_move = get_ai_move()
            
            from_square = chess.parse_square(ai_move.uci()[:2])
            to_square = chess.parse_square(ai_move.uci()[2:4])
            piece = game.piece_at(from_square)
            
            if piece and piece.piece_type == chess.PAWN:
                if (piece.color == chess.WHITE and to_square // 8 == 7) or (piece.color == chess.BLACK and to_square // 8 == 0):
                    ai_move = chess.Move(from_square, to_square, promotion=chess.QUEEN)
            
            game.push(ai_move)
            current_player = 'white'
            emit('update_board', game.fen(), broadcast=True)
            emit('update_clock', clock, broadcast=True)
            emit('strategy_suggestion', get_strategy_suggestion(), broadcast=True)
            
            if game.is_game_over():
                result = game.result()
                winner = 'White' if result == '1-0' else 'Black' if result == '0-1' else 'Draw'
                if game.is_checkmate():
                    ai_surrender = analyze_ai_options()
                    emit('game_over', {'winner': winner, 'ai_surrender': ai_surrender}, broadcast=True)
                else:
                    emit('game_over', {'winner': winner}, broadcast=True)

@app.route('/set_difficulty', methods=['POST'])
def set_difficulty():
    global difficulty
    new_difficulty = request.json.get('difficulty')
    if new_difficulty in ['easy', 'medium', 'hard']:
        difficulty = new_difficulty
        return jsonify({"status": "success", "message": f"Difficulty set to {difficulty}"})
    else:
        return jsonify({"status": "error", "message": "Invalid difficulty level"}), 400

def analyze_ai_options():
    legal_moves = list(game.legal_moves)
    if len(legal_moves) == 0:
        return True
    return False

@socketio.on('clock_tick')
def handle_clock_tick():
    global clock
    clock[current_player] -= 1
    if clock[current_player] <= 0:
        winner = 'white' if current_player == 'black' else 'black'
        emit('game_over', {'winner': winner.capitalize()}, broadcast=True)
    else:
        emit('update_clock', clock, broadcast=True)

@socketio.on('reset_game')
def handle_reset_game():
    global game, clock, current_player
    game = chess.Board()
    clock = {'white': 600, 'black': 600}
    current_player = 'white'
    emit('update_board', game.fen(), broadcast=True)
    emit('update_clock', clock, broadcast=True)
    emit('strategy_suggestion', get_strategy_suggestion(), broadcast=True)

def get_strategy_suggestion():
    suggestions = [
        "Control the center of the board",
        "Develop your pieces early",
        "Castle your king to safety",
        "Connect your rooks",
        "Create pawn chains for protection",
        "Look for tactical opportunities",
        "Protect your king",
        "Create weaknesses in opponent's position",
        "Double your rooks on open files",
        "Activate your knights in the endgame"
    ]
    return random.choice(suggestions)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
