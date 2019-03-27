const express = require('express')
const request = require('request')
const querystring = require('querystring')
const body_parser = require('body-parser')
const cors = require('cors')
const fetch = require('node-fetch')
const http = require('http')
const socket = require('socket.io')

const app = express()

let port = process.env.PORT || 8888
console.log(`Listening on port ${port}. Go /login to initiate authentication flow.`)
let server = app.listen(port)

app.use(body_parser.json())
app.use(cors({
  'allowedHeaders': ['sessionId', 'Content-Type'],
  'exposedHeaders': ['sessionId'],
  'origin': '*',
  'methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
  'preflightContinue': false
}))

const io = socket.listen(server)
io.on('connection', socket => {
  console.log("a user has connected")
  socket.on('disconnect', () => {
    console.log("user disconnected")
  })
  socket.on('joinVenue', connectCode => {
    socket.join(connectCode)
    io.to(connectCode).emit('updatedQueue', getVenue(connectCode).queue)
  })
  socket.on('leave', connectCode => {
    socket.leave(connectCode)
  })
})

//console.log(process.env);
let redirect_uri = 
  process.env.REDIRECT_URI || 
  'https://mod3backend.herokuapp.com/callback'

app.get('/login', function(req, res) {
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: process.env.SPOTIFY_CLIENT_ID,
      scope: 'user-read-private user-read-email user-modify-playback-state app-remote-control streaming user-read-birthdate user-read-recently-played',
      redirect_uri
    }))
})

app.get('/callback', function(req, res) {
  let code = req.query.code || null
  let authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    form: {
      code: code,
      redirect_uri,
      grant_type: 'authorization_code'
    },
    headers: {
      'Authorization': 'Basic ' + (Buffer.from(
        process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
      ).toString('base64'))
    },
    json: true
  }
  request.post(authOptions, function(error, response, body) {
    var access_token = body.access_token
    let uri = process.env.FRONT_END_URI || 'https://mod3frontend.herokuapp.com/'
    res.redirect(uri + '?access_token=' + access_token)
  })
})


var venues = []
var connectCodeCounter = 0

let getVenue = (connectCode) => {
  for(i=0; i<venues.length; i++) {
    if(venues[i].connectCode == connectCode) {
      return venues[i]
    }
  }
}

// TODO: put all of the below into one "/venue" endpoint
app.post('/create', function(req, res) {
  console.log(req.body)
  let newConnectCode = connectCodeCounter.toString() + Math.random().toString().slice(2, 6)
  let newHostCode = Math.random().toString().slice(2, 100)
  venues.push({
    "connectCode" : newConnectCode,
    "hostCode" : newHostCode,
    "name" : req.body.name,
    "queue" : [],
    "votingHistory" : {},
    "guests" : []
  })
  res.send({
    "newConnectCode" : newConnectCode,
    "newHostCode" : newHostCode
  })
  connectCodeCounter += 1
  //console.log(JSON.stringify(venues))
})

app.get('/join', function(req, res) {
  console.log(req.query)
  let venue = getVenue(req.query.connectCode)
  if(venue) {
    res.status(200).send({venueName : venue.name})
  } else {
    res.sendStatus(400)
  }
})

app.put('/vote', function(req, res) {
  console.log("voting: " + req.body.track.name)
  let venue = getVenue(req.body.connectCode)
  if(!venue) {
    res.status(400).send("invalid connectCode")
    return;
  }

  let queue = venue.queue
  let votingHistory = venue.votingHistory
  let guests = venue.guests
  let token = req.access_token
  let track = req.body.track
  fetch('https://api.spotify.com/v1/me', {
    headers: {'Authorization': 'Bearer ' + token}
  })
  .then(response => response.json())
  .then(userData => {
    // hopefully prevent people voting when not logged in
    if(!userData || !userData.id) {
      res.status(400).send("invalid access token")
      return;
    }
    // init voting history
    if(!votingHistory[userData.id]) {
      votingHistory[userData.id] = []
      guests.push(userData)
    }
    let pastTracks = votingHistory[userData.id]
    let alreadyVoted = false
    // check if the song is already in the playlist
    let alreadyInQueue = false
    for(i=0; i<queue.length; i++) {
      if(queue[i].uri === track.uri) {
        alreadyInQueue = true
        // check that the user hasn't voted for this track on this venue
        pastTracks.forEach(pastTrack => {
          if(pastTrack.uri === track.uri) {
            alreadyVoted = true
          }
        })
        if(!alreadyVoted) {
          queue[i].numVotes++
          votingHistory[userData.id].push(track)
        }
      }
    }
    if(!alreadyInQueue) {
      track.numVotes = 1;
      track.wasPlayed = false
      queue.push(track)
      votingHistory[userData.id].push(track)
    }
    if(!alreadyVoted) {
      io.to(req.body.connectCode).emit('updatedQueue', queue) // send updated queue to the room
      res.sendStatus(200)
    } else {
      res.status(400).send("user has already vote for: " + track.name)
    }
  })
})

app.put('/setPlayed', function(req, res) {
  console.log(req.body.track.name + " has now been played")
  if (getVenue(req.body.connectCode) && getVenue(req.body.connectCode).hostCode == req.body.hostCode) {
    var queue = getVenue(req.body.connectCode).queue
  } else {
    res.sendStatus(400)
    return;
  }
  
  let foundSong = false
  for(i=0; i<queue.length; i++) {
    if(queue[i].uri == req.body.track.uri) {
      queue[i].wasPlayed = true
      foundSong = true
    }
  }
  res.sendStatus(foundSong ? 200 : 400)
})

app.get('/queue', function(req, res) {
  console.log(req.query)
  let venue = getVenue(req.query.connectCode)
  if (venue) {
    res.send(venue.queue)
  } else {
    res.sendStatus(400)
    return
  }
})
