/*
 *
 *
 * THE_JAMES_CAIRD: a little app out in the ocean making mobile tickets
 * 
 */
//
//MODULE DEPENDENCIES:
var application_root = __dirname,
    express = require('express'),
    path = require('path'),
    format = require('util').format,
    fs = require('fs'),
    exec = require('child_process').exec,    
    https = require('https'),
    express_validator = require('express-validator'),
    AWS = require('aws-sdk');



//setup AWS stuff
AWS.config.update({"accessKeyId": process.env.AWS_ACCESS_KEY_ID,
                   "secretAccessKey": process.env.AWS_SECRET_ACCESS_KEY,
                   "region": process.env.AWS_REGION,
                   "sslEnabled": true});

//console.log(process.env);


//The http server will listen to an appropriate port, or default to
//port 5001.
var port = process.env.PORT || 5001;
console.log('process.env.PORT: ' + process.env.PORT);


//create the express application. express() returns a Function designed to 
//be passed to nodes http/https servers as a callback to handle requests. 
var app = express();



//CONFIGURE SERVER:
app.configure(function () {
  app.use(express.bodyParser());
  app.use(express_validator());
  app.use(express.methodOverride());
  app.use(express.query());
  app.use(express.cookieParser('my secret string'));
  app.use(app.router);


  //express will use the first static path to foler it encounters. so when site_prod 
  //app.use call is uncommented it will use that & ignore site_dev static folder even 
  //when it is uncommented also (!)
  //uncomment this to use production, optimized, code from r.js process
  //app.use(express.static(path.join(application_root, 'site_prod')));

  //this sets the app to serve development code which is _not_ optimized 
  //app.use(express.static(path.join(application_root, 'site_dev')));

  app.use(express.errorHandler({dumpExceptions: true, showStack: true}));
});



app.get('/', function (req, res) {
  return res.send('hello there dude');
});



//platying around with S3, creating buckets and filling them.
app.get('/api/apple', function (req, res) {
  console.log('in the_james_caird app, GET /api/apple handler');
  console.log('req.query:');
  console.log(req.query); //should have gig and order id sent thru in querystring

  /*
  s3.createBucket({Bucket: process.env.AWS_S3_BUCKET_APPLE}, function (err, data) {
    if (err) {
      console.log(err);
    } else {
      console.log(data);
      s3.putObject({
          Bucket: process.env.AWS_S3_BUCKET_APPLE,
          Key:    'gig_id',
          Body:   req.query.gig 
        },
        function (err, data) {
          if (err) {
            console.log(err); 
          } else {
            console.log(data);
          }
      });
    }
  });
  */

  //list all the S3 buckets
  var s3 = new AWS.S3();
    s3.listBuckets(function(err, data) {
      console.log('=====> getting the list of all S3 buckets...');
      for (var index in data.Buckets) {
        var bucket = data.Buckets[index];
        console.log("Bucket: ", bucket.Name, ' : ', bucket.CreationDate);
      }
  });



  s3.getObject({
      Bucket: process.env.AWS_S3_BUCKET_APPLE,
      'Key': req.query.gig_id + '/pass.json'
      }
    , function (err, data) {
        if (err) {
          console.log(err); 
        } if (!data) {
          console.log('data is null');
        } else {
          console.log('=====> got \'pass.json\' object from s3:');
          console.log(data); //data.Body is of type Buffer
          var _body = data.Body.toString('utf8');
          console.log('body of the \'pass.json\' object in s3 is: ' + _body);

          
          console.log('saving to ephemeral filesystem...');
          fs.writeFile('pass.json', _body, function (err) {
            if (err) {
              console.log(err); 
            } else {
              console.log('wrote pass.json to the filesys');
              console.log('reading the dir...');
              fs.readdir('.', function (err, files) {
                if (err) {
                  console.log(err);
                } else {
                  for (var i in files) {
                    console.log('files[' + i + ']' + files[i]);
                  }
                }
              });
              
            }
          });

        }
      }
  );




  /*
  s3.getObject({
      Bucket: process.env.AWS_S3_BUCKET_APPLE,
      'Key': 'gig_id'
      }
    , function (err, data) {
        if (err) {
          console.log(err); 
        } else {
          console.log('=====> got object from s3:');
          console.log(data);
          //data.Body is of type Buffer
          var body = data.Body.toString('utf8');
          console.log('body of the object in s3 is: '+ body);

        }
      }
  );
  */




  //start experimental section ---------------------
  /*

    var pass_name = req.params['gig_id'] + '.pkpass';

    //the directory relative to shackelton/ to execute commands.
    //will/should be different for different pkpasses but for now its
    //hardcoded during demoing stage
    var wrk_dir = './etix/apple/' + req.params['gig_id'] + '/';


    //-------------------------------------------------------------------------
    //BUG?: what happens if manifest.json has not been completely created
    //and the .pkpass routines finish before that? incomplete manifest.json
    //file -> invalid pass! callback embedding of these 2 procedures..?
    //create the manifest.json file programatically
    fs.readdir(wrk_dir, function(err, names){

      //compute hash of pass.json file
      exec('openssl sha1 pass.json', {cwd: wrk_dir}, function(err, stdout, stderr){
        if(!err) {
          console.log('hello from pass.json sha1 block');

          var content = stdout;
          var start_index_of_hash = content.indexOf('=') + 2
          var hash = content.substring(start_index_of_hash, content.length - 1);

          //put the (pass.json, hash) pair into the manifest_content object
          manifest_content["pass.json"] = hash;
        } else {
          console.log('Pkpass:[' + req.params['gig_id']
            + ']' + 'OPENSSL_ERROR: Unable to sha1 pass.json file.' + err);
        }
      });

      console.log('Pkpass:[' + req.params['gig_id']
        + ']' + 'The current directory contains image files:');


     for(var i = 0; i < names.length; i++) {
       if (names[i].indexOf('.png') >= 0){
         console.log('Pkpass:[' + req.params['gig_id'] + ']' + names[i]);
         exec('openssl sha1 ' + names[i], {cwd: wrk_dir}, function(err, stdout, stderr){
           if(!err){
             //console.log('stdout: ' + stdout);
             //console.log('names: ' + names[i]);

             var content = stdout;
             var start_index_of_hash = content.indexOf('=') + 2
             var left_brace = content.indexOf('(');
             var right_brace = content.indexOf(')');


             //also, strip the newline character from end of hash.
             var hash = content.substring(start_index_of_hash, content.length - 1);
             var file_name = content.substring(left_brace + 1, right_brace);


             //put the (file_name, hash) pair into the manifest_content obj.
             manifest_content[file_name] = hash;

             console.log('Pkpass:[' + req.params['gig_id'] + ']'
               + 'manifest_content.' + file_name + '=' + manifest_content[file_name]);


             fs.writeFile( wrk_dir + 'manifest.json', JSON.stringify(manifest_content),
               function(err){
                     if (err) {
                       throw err;
                     } else {
                       console.log('Pkpass:[' + req.params['gig_id']
                         + ']' + 'FILE_SAVED: manifest.json');
               } //end if-else file saved OK
             }); //end writeFile manifest.json
           } else {
             console.log('Pkpass:[' + req.params['gig_id']
               + ']' + 'OPENSSL_ERROR: Unable to sha1 ' + names[i] + ' file.');
           }
         }); //end calc sha1 for .png files
       } //end if-names end in .png
     } //end for-loop
   }); //end fs.readdir

   //--------------------------------------------------------------------------


    //create a .pkpass pass using Openssl and  Certificates.p12, WWDR.pem files
    //export Certificates.p12 into a different format, passcertificate.pem
    exec("openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out passcertificate.pem -passin pass:", {cwd: wrk_dir}, function(err, stdout, stderr){
      if(!err){
        var content = stdout;
        console.log('Pkpass:[' + req.params['gig_id'] + ']' + 'OPENSSL_SUCCESS: Certificates.p12 -> passcertificate.pem');

        //export the key as a separate file, passkey.pem
        exec("openssl pkcs12 -in Certificates.p12 -nocerts -out passkey.pem -passin pass:-passout pass:12345", {cwd: wrk_dir}, function(err, stdout, stderr){
          if(!err){
            var content = stdout;
            console.log('Pkpass:[' + req.params['gig_id']
              + ']' + 'OPENSSL_SUCCESS: Certificates.p12 -> passkey.pem');

            //create the signature file.
            exec("openssl smime -binary -sign -certfile WWDR.pem -signer passcertificate.pem -inkey passkey.pem -in manifest.json -out signature -outform DER -passin pass:12345", {cwd: wrk_dir}, function(err, stdout, stderr){
              if(!err){
                var content = stdout;
                console.log('Pkpass:[' + req.params['gig_id']
                  + ']' + 'OPENSSL_SUCCESS: Created the signature file.');

                //finally, create the .pkpass zip file, freehugcoupon.pkpass
                exec("zip -r " + pass_name + " manifest.json pass.json signature logo.pnglogo@2x.png icon.png icon@2x.png strip.png strip@2x.png", {cwd: wrk_dir}, function(err, stdout, stderr){
                  if(!err){
                    var content = stdout;
                    console.log('Pkpass:[' + req.params['gig_id'] + ']' + stdout);
                    console.log('Pkpass:[' + req.params['gig_id']
                      + ']' + 'ZIP_SUCCESS: Created the .pkpass file.');


                    //check to see if the file exists before allowing it to be downloaded.
                    fs.exists( wrk_dir + pass_name, function(exists){
                      if (exists){

                        //you must set the mime type for the content to respond with
                        //so safari can recognize it.
                        //does this also work for other mobile browsers?
                        //e.g. mobile chrome browser on iphone?
                        res.contentType('application/vnd.apple.pkpass');

                        //DELIVER THE FINAL PRODUCT: the pass !!!
                        res.download( wrk_dir + pass_name);
                      } else {
                        console.log('Pkpass:[' + req.params['gig_id']
                          + ']' + pass_name + ' does not exist, yet.');
                      }
                    });
                  } else {
                    console.log('Pkpass:[' + req.params['gig_id'] + ']'
                      + 'ZIP_ERROR: Could not create the .pkpass file.');
                  }
                }); //end zip exec
              } else {
                console.log('Pkpass:[' + req.params['gig_id'] + ']'
                  + 'OPENSSL_ERROR: Could not make signature file.');
              }
            });
          } else {
            console.log('Pkpass:[' + req.params['gig_id'] + ']'
              + 'OPENSSL_ERROR: Could not make passkey.pem');
          }
        });
      } else {
        console.log('Pkpass:[' + req.params['gig_id'] + ']'
          + 'OPENSSL_ERROR: Could not make passcertificate.pem'+ stderr);
      }
    });

    //end experimental section ---------------------
    */




  return res.send('response from THE_JAMES_CAIRD_application: I tried/set up the bucket');


  });




//heholllllooo





//Heroku: start production server. ssl endpoint is used for https so use standard
//http server

app.listen(port, function () {
 console.log('HTTP Express server listening on port %d in %s mode', 
   port, app.settings.env);
});
